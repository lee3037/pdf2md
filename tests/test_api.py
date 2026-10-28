import json
import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("STRATUM_WORKERS", "1")

from fastapi.testclient import TestClient  # noqa: E402

from app.server import app  # noqa: E402
from app import parsers, server  # noqa: E402
from app.parsers.oxr import OXRParser  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def wait_done(client, job_id, timeout=180):
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.3)
    raise TimeoutError(job_id)


def test_startup_does_not_initialize_local_models(monkeypatch):
    def unexpected_pool():
        raise AssertionError("启动服务不应创建本地模型工作池")
    monkeypatch.setattr(server, "_get_pool", unexpected_pool)
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200


def test_parser_catalog_and_unknown_parser(client):
    assert client.get("/api/parsers").json() == {"parsers": parsers.catalog()}
    assert client.get("/api/defaults").json()["parser"] == "pymupdf"
    result = client.post("/api/jobs", files={"file": ("a.pdf", b"%PDF", "application/pdf")},
                         data={"options": json.dumps({"parser": "unknown"})})
    assert result.status_code == 400 and "未知解析后端" in result.json()["detail"]
    result = client.post("/api/jobs", files={"file": ("a.pdf", b"%PDF", "application/pdf")},
                         data={"options": "[]"})
    assert result.status_code == 400


def test_oxr_job_and_rechunk_preserve_only_source_warnings(client, monkeypatch):
    import httpx
    import pymupdf

    payload = {"code": 0, "warnings": ["保留识别提示"], "data": {"error": None, "result": {"outputs": {"json": {
        "pages": [{"page_num": 0, "page_size": {"w": 1240, "h": 1755}, "blocks": [
            {"type": "Text", "content": "分隔符 ===CHUNK=== 也属于原文。", "format": "text", "bbox": [50, 200, 900, 250]},
            {"type": "Formula", "content": "x_1+" * 100, "format": "latex", "bbox": [50, 300, 900, 400]},
        ]}],
    }}}}}
    backend = OXRParser(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))
    monkeypatch.setitem(parsers._registry, "oxr", backend)

    def unexpected_pool():
        raise AssertionError("OXR 任务不应创建本地模型工作池")
    monkeypatch.setattr(server, "_get_pool", unexpected_pool)
    monkeypatch.setattr(server._runner, "submit", lambda function, *args: function(*args))
    with pymupdf.open() as doc:
        doc.new_page()
        pdf = doc.tobytes()
    created = client.post("/api/jobs", files={"file": ("remote.pdf", pdf, "application/pdf")},
                          data={"options": json.dumps({"parser": "oxr", "max_chars": 100, "ocr_dpi": "ignored"})})
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "done", job
    assert any("超过最大字数" in w for w in job["result"]["warnings"])
    assert any("与分隔符相同" in w for w in job["result"]["warnings"])
    for _ in range(2):
        rechunked = client.post(f"/api/jobs/{job_id}/rechunk", json={"options": {"separator": "@@@", "max_chars": 1000}})
        warnings = rechunked.json()["warnings"]
        assert warnings.count("OXR：保留识别提示") == 1
        assert sum("通过 OCR 识别" in w for w in warnings) == 1
        assert not any("超过最大字数" in w or "与分隔符相同" in w for w in warnings)


def test_convert_rechunk_and_errors(client):
    pdf = ROOT / "samples" / "complex_cn.pdf"
    with open(pdf, "rb") as f:
        r = client.post("/api/jobs", files={"file": ("预算.pdf", f, "application/pdf")},
                        data={"options": json.dumps({"separator": "@@@", "max_chars": 800})})
    assert r.status_code == 200, r.text
    job = wait_done(client, r.json()["id"])
    assert job["status"] == "done", job
    res = job["result"]
    assert "@@@" in res["markdown"] and res["stats"]["chunks"] == len(res["chunks"])
    assert all(c["chars"] <= 800 for c in res["chunks"])

    r2 = client.post(f"/api/jobs/{job['id']}/rechunk", json={"options": {"table_mode": "kv", "max_chars": 500}})
    assert r2.status_code == 200
    assert "部门：研发部；项目：人员经费" in r2.json()["markdown"]
    assert "===CHUNK===" in r2.json()["markdown"]

    assert client.get(f"/api/jobs/{job['id']}/pdf").headers["content-type"] == "application/pdf"
    assert client.get("/api/jobs/nope").status_code == 404
    bad = client.post("/api/jobs", files={"file": ("a.pdf", b"hello", "application/pdf")})
    assert bad.status_code == 400
    assert client.get("/").status_code == 200
