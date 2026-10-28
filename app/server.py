"""Web 服务：上传 PDF → 异步转换（进度可查）→ 预览/重新分块/下载。"""
from __future__ import annotations

import json
import multiprocessing as mp
import os
import shutil
import tempfile
import threading
import time
import traceback
import uuid
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import chunker, extract, pipeline

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
WORKERS = int(os.environ.get("STRATUM_WORKERS") or max(1, min(3, (os.cpu_count() or 2) // 2)))
MAX_UPLOAD_MB = int(os.environ.get("STRATUM_MAX_MB", "200"))
MAX_PAGES = int(os.environ.get("STRATUM_MAX_PAGES", "2000"))
JOB_TTL = int(os.environ.get("STRATUM_JOB_TTL", str(3 * 3600)))
WORK_DIR = Path(os.environ.get("STRATUM_WORK_DIR") or tempfile.mkdtemp(prefix="stratum-"))

_pool: ProcessPoolExecutor | None = None
_runner = ThreadPoolExecutor(max_workers=4, thread_name_prefix="job")
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        os.environ.setdefault("STRATUM_OCR_THREADS", str(max(1, (os.cpu_count() or 2) // WORKERS)))
        _pool = ProcessPoolExecutor(max_workers=WORKERS, mp_context=mp.get_context("spawn"),
                                    initializer=extract.worker_init)
    return _pool


@asynccontextmanager
async def lifespan(_app):
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    pool = _get_pool()
    # 提前拉起工作进程并加载模型
    for _ in range(WORKERS):
        pool.submit(time.sleep, 0)
    threading.Thread(target=_cleanup_loop, daemon=True).start()
    yield
    pool.shutdown(cancel_futures=True)
    shutil.rmtree(WORK_DIR, ignore_errors=True)


app = FastAPI(title="Stratum 层析", lifespan=lifespan)


def _cleanup_loop():
    while True:
        time.sleep(600)
        now = time.time()
        with _lock:
            expired = [k for k, j in _jobs.items() if now - j["updated"] > JOB_TTL and j["status"] in ("done", "error")]
            for k in expired:
                job = _jobs.pop(k)
                shutil.rmtree(job["dir"], ignore_errors=True)


def _update(job_id, **kw):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(kw, updated=time.time())


def _run_job(job_id: str):
    job = _jobs[job_id]
    try:
        _update(job_id, status="running", stage="版面分析")

        def progress(done, total):
            _update(job_id, progress={"done": done, "total": total})

        conv = pipeline.ConvertOptions.from_dict(job["convert_options"])
        copts = chunker.ChunkOptions.from_dict(job["chunk_options"])
        out = pipeline.convert(job["pdf"], conv, copts, _get_pool(), WORKERS, progress)
        _update(job_id, status="done", stage="完成", elements=out["elements"], result=out["result"],
                elapsed=round(time.time() - job["created"], 1))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        msg = str(e) or e.__class__.__name__
        _update(job_id, status="error", stage="失败", error=msg)


def _public(job: dict, with_result=True) -> dict:
    data = {k: job.get(k) for k in ("id", "filename", "status", "stage", "progress", "error", "elapsed", "page_count")}
    if with_result and job.get("result"):
        data["result"] = job["result"]
    return data


@app.post("/api/jobs")
async def create_job(file: UploadFile = File(...), options: str = Form("{}")):
    try:
        opts = json.loads(options or "{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "options 不是合法的 JSON")
    name = Path(file.filename or "document.pdf").name
    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True)
    pdf_path = job_dir / "source.pdf"
    size = 0
    with open(pdf_path, "wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_MB << 20:
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(413, f"文件超过 {MAX_UPLOAD_MB} MB 上限")
            f.write(chunk)
    with open(pdf_path, "rb") as f:
        if not f.read(1024).lstrip().startswith(b"%PDF"):
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(400, "上传的文件不是 PDF")
    try:
        info = extract.document_info(str(pdf_path))
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"无法打开 PDF：{e}")
    if info["page_count"] > MAX_PAGES:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"页数 {info['page_count']} 超过上限 {MAX_PAGES}")
    now = time.time()
    job = {
        "id": job_id, "filename": name, "dir": str(job_dir), "pdf": str(pdf_path),
        "status": "queued", "stage": "排队中", "progress": {"done": 0, "total": info["page_count"]},
        "page_count": info["page_count"], "convert_options": opts, "chunk_options": opts,
        "created": now, "updated": now,
    }
    with _lock:
        _jobs[job_id] = job
    _runner.submit(_run_job, job_id)
    return {"id": job_id, "page_count": info["page_count"]}


def _job_or_404(job_id: str) -> dict:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在或已过期，请重新上传")
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    return _public(_job_or_404(job_id))


class RechunkBody(BaseModel):
    options: dict = {}


@app.post("/api/jobs/{job_id}/rechunk")
def rechunk(job_id: str, body: RechunkBody):
    job = _job_or_404(job_id)
    if job["status"] != "done":
        raise HTTPException(409, "转换尚未完成")
    copts = chunker.ChunkOptions.from_dict(body.options)
    result = chunker.to_markdown(job["elements"], copts)
    old = job["result"]
    result["doc_stats"] = old.get("doc_stats", {})
    result["warnings"] += [w for w in old.get("warnings", []) if "OCR" in w]
    _update(job_id, result=result, chunk_options=body.options)
    return result


@app.get("/api/jobs/{job_id}/pdf")
def get_pdf(job_id: str):
    job = _job_or_404(job_id)
    return FileResponse(job["pdf"], media_type="application/pdf",
                        headers={"Content-Disposition": "inline"})


@app.get("/api/defaults")
def defaults():
    from dataclasses import asdict
    return {**asdict(pipeline.ConvertOptions()), **asdict(chunker.ChunkOptions()), "workers": WORKERS,
            "max_upload_mb": MAX_UPLOAD_MB}


@app.get("/api/health")
def health():
    return JSONResponse({"ok": True, "jobs": len(_jobs), "workers": WORKERS})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
