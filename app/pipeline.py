"""转换流水线：分批（可并行）解析页面 → 结构整理 → 分块。"""
from __future__ import annotations

import math
from concurrent.futures import Executor, as_completed
from dataclasses import asdict, dataclass

from . import chunker, extract, structure


@dataclass
class ConvertOptions:
    ocr_mode: str = "auto"  # auto | force | off
    ocr_dpi: int = 200
    remove_header_footer: bool = True

    @classmethod
    def from_dict(cls, d: dict | None) -> "ConvertOptions":
        d = d or {}
        o = cls()
        for k in asdict(o):
            if k in d and d[k] is not None:
                v = d[k]
                if isinstance(getattr(o, k), bool) and isinstance(v, str):
                    v = v.lower() in ("1", "true", "yes", "on")
                setattr(o, k, type(getattr(o, k))(v))
        if o.ocr_mode not in ("auto", "force", "off"):
            o.ocr_mode = "auto"
        o.ocr_dpi = max(100, min(300, o.ocr_dpi))
        return o


def _batches(n_pages: int, workers: int) -> list[list[int]]:
    size = max(1, min(8, math.ceil(n_pages / max(1, workers * 3))))
    return [list(range(i, min(i + size, n_pages))) for i in range(0, n_pages, size)]


def extract_document(path: str, opts: ConvertOptions, executor: Executor | None = None,
                     workers: int = 1, progress=None) -> tuple[list[dict], dict]:
    info = extract.document_info(path)
    n = info["page_count"]
    if n == 0:
        raise ValueError("PDF 没有页面")
    batches = _batches(n, workers)
    pages: list[dict] = []
    done = 0
    if progress:
        progress(0, n)
    if executor is None:
        for b in batches:
            pages += extract.extract_pages(path, b, opts.ocr_mode, opts.ocr_dpi)
            done += len(b)
            if progress:
                progress(done, n)
    else:
        futs = {executor.submit(extract.extract_pages, path, b, opts.ocr_mode, opts.ocr_dpi): b for b in batches}
        for f in as_completed(futs):
            pages += f.result()
            done += len(futs[f])
            if progress:
                progress(done, n)
    pages.sort(key=lambda p: p["number"])
    return pages, info


def convert(path: str, conv: ConvertOptions, chunk_opts: chunker.ChunkOptions,
            executor: Executor | None = None, workers: int = 1, progress=None) -> dict:
    pages, info = extract_document(path, conv, executor, workers, progress)
    elements, stats = structure.build_elements(pages, info["toc"], conv.remove_header_footer)
    result = chunker.to_markdown(elements, chunk_opts)
    result["doc_stats"] = stats
    if not result["chunks"]:
        hint = "可能是扫描件，请把 OCR 设为“自动”或“强制”后重试。" if conv.ocr_mode == "off" else "请确认 PDF 是否包含可识别的文字。"
        result["warnings"].append("未提取到任何文本内容，" + hint)
    if stats["ocr_pages"]:
        result["warnings"].append(f"{stats['ocr_pages']} 页通过 OCR 识别，建议重点核对数字与专有名词。")
    return {"elements": elements, "result": result}
