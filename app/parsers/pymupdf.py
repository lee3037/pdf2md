"""默认后端：PyMuPDF Layout 与 RapidOCR。"""
from __future__ import annotations

import math
from concurrent.futures import Executor, as_completed
from typing import TYPE_CHECKING

from .. import extract, structure
from .base import ParsedDocument, Progress

if TYPE_CHECKING:
    from ..pipeline import ConvertOptions


def _batches(n_pages: int, workers: int) -> list[list[int]]:
    size = max(1, min(8, math.ceil(n_pages / max(1, workers * 3))))
    return [list(range(i, min(i + size, n_pages))) for i in range(0, n_pages, size)]


def extract_document(path: str, opts: ConvertOptions, executor: Executor | None = None,
                     workers: int = 1, progress: Progress | None = None) -> tuple[list[dict], dict]:
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
        for batch in batches:
            pages += extract.extract_pages(path, batch, opts.ocr_mode, opts.ocr_dpi)
            done += len(batch)
            if progress:
                progress(done, n)
    else:
        futures = {executor.submit(extract.extract_pages, path, batch, opts.ocr_mode, opts.ocr_dpi): batch
                   for batch in batches}
        for future in as_completed(futures):
            pages += future.result()
            done += len(futures[future])
            if progress:
                progress(done, n)
    pages.sort(key=lambda page: page["number"])
    return pages, info


class PyMuPDFParser:
    id = "pymupdf"
    name = "PyMuPDF + RapidOCR"
    local_ocr_options = True
    uses_local_workers = True

    def parse(self, path, options, executor=None, workers=1, progress=None) -> ParsedDocument:
        pages, info = extract_document(path, options, executor, workers, progress)
        elements, stats = structure.build_elements(pages, info["toc"], options.remove_header_footer)
        warnings = []
        if not elements:
            hint = ("可能是扫描件，请把 OCR 设为“自动”或“强制”后重试。" if options.ocr_mode == "off"
                    else "请确认 PDF 是否包含可识别的文字。")
            warnings.append("未提取到任何文本内容，" + hint)
        return ParsedDocument(elements, stats, warnings)
