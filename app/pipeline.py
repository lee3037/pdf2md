"""转换流水线：选择文档解析后端 → 统一分块。"""
from __future__ import annotations

from concurrent.futures import Executor
from dataclasses import asdict, dataclass

from . import chunker, parsers
# 保留现有调用入口；实现归属默认解析后端。
from .parsers.pymupdf import extract_document  # noqa: F401


@dataclass
class ConvertOptions:
    ocr_mode: str = "auto"  # auto | force | off
    ocr_dpi: int = 200
    remove_header_footer: bool = True
    parser: str = "pymupdf"

    @classmethod
    def from_dict(cls, d: dict | None) -> "ConvertOptions":
        d = {} if d is None else d
        if not isinstance(d, dict):
            raise ValueError("options 必须是 JSON 对象")
        o = cls()
        if d.get("parser") is not None:
            o.parser = str(d["parser"])
        backend = parsers.get_parser(o.parser)
        for k in asdict(o):
            if k in ("ocr_mode", "ocr_dpi") and not backend.local_ocr_options:
                continue
            if k in d and d[k] is not None:
                v = d[k]
                if isinstance(getattr(o, k), bool) and isinstance(v, str):
                    v = v.lower() in ("1", "true", "yes", "on")
                setattr(o, k, type(getattr(o, k))(v))
        if o.ocr_mode not in ("auto", "force", "off"):
            o.ocr_mode = "auto"
        o.ocr_dpi = max(100, min(300, o.ocr_dpi))
        return o


def convert(path: str, conv: ConvertOptions, chunk_opts: chunker.ChunkOptions,
            executor: Executor | None = None, workers: int = 1, progress=None) -> dict:
    backend = parsers.get_parser(conv.parser)
    parsed = backend.parse(path, conv, executor, workers, progress)
    source_warnings = list(parsed.warnings)
    if parsed.stats["ocr_pages"]:
        source_warnings.append(f"{parsed.stats['ocr_pages']} 页通过 OCR 识别，建议重点核对数字与专有名词。")
    result = chunker.to_markdown(parsed.elements, chunk_opts)
    result["doc_stats"] = parsed.stats
    result["warnings"] = list(dict.fromkeys(source_warnings + result["warnings"]))
    return {"elements": parsed.elements, "result": result, "source_warnings": source_warnings}
