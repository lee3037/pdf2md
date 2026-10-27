"""在工作进程中运行：用 PyMuPDF Layout 做版面分析（必要时 RapidOCR），输出可序列化的页面结构。

每个页面输出：
    {"number", "width", "height", "ocr", "boxes": [box, ...]}
box:
    {"cls", "bbox", "lines": [{"text", "bbox", "size", "bold"}], "table": {...} | None, "max_fontsize"}
"""
from __future__ import annotations

import contextlib
import io
import os

import pymupdf

_OCR_PAGES: set[int] = set()
_OCR_FUNC = None


def _ocr_wrapper(page, **kwargs):
    _OCR_PAGES.add(page.number)
    return _OCR_FUNC(page, **kwargs)


def worker_init():
    """进程初始化：限制单进程线程数，预加载版面模型与 OCR 模型。"""
    global _OCR_FUNC
    threads = os.environ.get("PDF2MD_OCR_THREADS")
    if threads:
        os.environ.setdefault("OMP_NUM_THREADS", threads)
    with contextlib.redirect_stdout(io.StringIO()):
        import pymupdf4llm  # noqa: F401  (激活 pymupdf.layout)
        from pymupdf4llm.ocr import rapidocr_api, rapidocr_onnx_backend
        from rapidocr_onnxruntime import RapidOCR

        # 默认 max_side_len=2000 会把 200dpi 的整页图缩小，导致表格内短数字识别错误
        kwargs = {"max_side_len": 4000}
        if threads:
            kwargs["intra_op_num_threads"] = int(threads)
        rapidocr_onnx_backend.ENGINE = RapidOCR(**kwargs)
        _OCR_FUNC = rapidocr_api.exec_ocr
        # 用一页小图预热模型，避免首个任务等待
        doc = pymupdf.open()
        page = doc.new_page(width=200, height=80)
        page.insert_text((10, 40), "warm up 预热", fontname="china-s", fontsize=14)
        pix = page.get_pixmap(dpi=100)
        img_doc = pymupdf.open()
        p2 = img_doc.new_page(width=200, height=80)
        p2.insert_image(p2.rect, stream=pix.tobytes("png"))
        try:
            _parse(img_doc, [0], "force", 200)
        except Exception:
            pass


def _parse(doc, pages, ocr_mode, ocr_dpi):
    from pymupdf4llm.helpers.document_layout import parse_document
    from pymupdf4llm.ocr import OCRMode

    mode = {
        "off": OCRMode.NEVER,
        "auto": OCRMode.SELECT_KEEP_OLD,
        "force": OCRMode.FORCE_DROP_OLD,
    }[ocr_mode]
    return parse_document(
        doc,
        pages=pages,
        use_ocr=mode,
        ocr_dpi=ocr_dpi,
        ocr_function=_ocr_wrapper if mode != OCRMode.NEVER else None,
        force_text=True,
        ocr_language="chi_sim+eng",
    )


def _span_is_bold(span) -> bool:
    return bool(span.get("flags", 0) & 16) or any(
        k in span.get("font", "").lower() for k in ("bold", "heavy", "black", "semibold", "黑体")
    )


def _line_from_spans(line) -> dict | None:
    spans = [s for s in line["spans"] if s.get("text")]
    if not spans:
        return None
    parts = []
    prev = None
    for s in spans:
        t = s["text"]
        if prev is not None:
            gap = s["bbox"][0] - prev["bbox"][2]
            if gap > 0.3 * max(s["size"], 1) and not parts[-1].endswith(" ") and not t.startswith(" "):
                parts.append(" ")
        parts.append(t)
        prev = s
    text = "".join(parts)
    nchars = sum(len(s["text"].strip()) for s in spans) or 1
    bold_chars = sum(len(s["text"].strip()) for s in spans if _span_is_bold(s))
    size = max(spans, key=lambda s: len(s["text"].strip()))["size"]
    return {
        "text": text,
        "bbox": [round(v, 2) for v in line["bbox"]],
        "size": round(size, 2),
        "bold": bold_chars / nchars > 0.6,
    }


def _iou(a, b) -> float:
    a, b = pymupdf.Rect(a), pymupdf.Rect(b)
    inter = a & b
    if inter.is_empty:
        return 0.0
    ia = inter.get_area()
    return ia / (a.get_area() + b.get_area() - ia)


def _cluster(values, tol=1.5):
    out = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


class _PageChars:
    """页面字符索引：按字符中心点取单元格文本，避免表格内文字顺序错乱。"""

    def __init__(self, page):
        self.lines = []  # (line_bbox, [(c, cx, cy)])
        raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_IMAGES)
        for block in raw["blocks"]:
            for line in block.get("lines", []):
                chars = [
                    (ch["c"], (ch["bbox"][0] + ch["bbox"][2]) / 2, (ch["bbox"][1] + ch["bbox"][3]) / 2)
                    for span in line["spans"]
                    for ch in span["chars"]
                ]
                if chars and line["dir"][0] > 0.9:
                    self.lines.append((line["bbox"], chars))

    def text_in(self, rect) -> str:
        x0, y0, x1, y1 = rect
        found = []
        for lb, chars in self.lines:
            if lb[3] < y0 or lb[1] > y1 or lb[2] < x0 or lb[0] > x1:
                continue
            sel = [c for c, cx, cy in chars if x0 <= cx <= x1 and y0 <= cy <= y1]
            if sel:
                found.append((lb[1], lb[0], "".join(sel)))
        found.sort(key=lambda t: (round(t[0] / 3), t[1]))
        # 同一视觉行的多个片段先拼起来
        merged: list[list] = []
        for y, x, t in found:
            if merged and abs(merged[-1][0] - y) < 3:
                merged[-1][1] += t
            else:
                merged.append([y, t])
        return "\n".join(t for _, t in merged)


def _grid_from_lines_table(tab, chars: _PageChars) -> list[list[str]] | None:
    """把 find_tables 结果转成完整网格，合并单元格的内容填充到其覆盖的所有格子。"""
    rows = tab.rows
    if not rows:
        return None
    xs = _cluster([c[0] for r in rows for c in r.cells if c])
    ys = _cluster([c[1] for r in rows for c in r.cells if c])
    nrows, ncols = len(rows), max(len(r.cells) for r in rows)
    grid: list[list[str | None]] = [[None] * ncols for _ in range(nrows)]
    for ri, row in enumerate(rows):
        for ci, cell in enumerate(row.cells):
            if cell is None:
                continue
            text = chars.text_in(cell)
            x0, y0, x1, y1 = cell
            nspan_c = max(1, sum(1 for x in xs if x0 - 1.5 <= x < x1 - 1.5))
            nspan_r = max(1, sum(1 for y in ys if y0 - 1.5 <= y < y1 - 1.5))
            for rr in range(ri, min(ri + nspan_r, nrows)):
                for cc in range(ci, min(ci + nspan_c, ncols)):
                    if grid[rr][cc] is None:
                        grid[rr][cc] = text
    return [[c or "" for c in row] for row in grid]


def _lines_table(page, rect, cache: dict):
    """用框线策略识别整页表格，取与版面表格框最匹配的一个，命中则返回 (网格, bbox)。"""
    if "tables" not in cache:
        try:
            cache["tables"] = page.find_tables().tables
        except Exception:
            cache["tables"] = []
    best = max(cache["tables"], key=lambda t: _iou(t.bbox, rect), default=None)
    if best is None or best.row_count < 2 or best.col_count < 2:
        return None
    r = pymupdf.Rect(rect)
    overlap = pymupdf.Rect(best.bbox) & r
    if _iou(best.bbox, rect) < 0.4 and overlap.get_area() < 0.8 * r.get_area():
        return None
    if "chars" not in cache:
        cache["chars"] = _PageChars(page)
    grid = _grid_from_lines_table(best, cache["chars"])
    return (grid, list(best.bbox)) if grid else None


def _fill_empty_ocr_cells(page, rows, cells, limit=150):
    """扫描页表格中空白但有墨迹的单元格，单独以 300dpi 重新识别（整页 OCR 容易漏掉短数字）。"""
    import numpy as np
    from pymupdf4llm.ocr import rapidocr_onnx_backend

    engine = rapidocr_onnx_backend.ENGINE
    if engine is None or not cells:
        return 0
    filled = tried = 0
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            if val or tried >= limit:
                continue
            try:
                rect = pymupdf.Rect(cells[r][c]) + (2, 2, -2, -2)
            except (IndexError, TypeError, ValueError):
                continue
            if rect.width < 5 or rect.height < 5:
                continue
            pix = page.get_pixmap(dpi=300, clip=rect, colorspace=pymupdf.csRGB, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
            if (img < 128).mean() < 0.01:  # 基本空白
                continue
            tried += 1
            pad = np.full((img.shape[0] + 20, img.shape[1] + 20, 3), 255, dtype=np.uint8)
            pad[10:-10, 10:-10] = img
            result, _ = engine(pad)
            text = "".join(t for _box, t, score in (result or []) if float(score) >= 0.6)
            if text:
                row[c] = text
                filled += 1
    return filled


def _convert_page(doc, pl, ocr_pages) -> dict:
    page_index = pl.page_number - 1
    page = None
    cache: dict = {}
    out_boxes = []
    for box in pl.boxes:
        b = {
            "cls": box.boxclass,
            "bbox": [round(box.x0, 2), round(box.y0, 2), round(box.x1, 2), round(box.y1, 2)],
            "lines": [],
            "table": None,
            "max_fontsize": box.max_fontsize,
        }
        if box.boxclass == "table" and box.table:
            tab = {"rows": box.table.get("extract"), "source": "layout"}
            if page_index in ocr_pages and tab["rows"]:
                if page is None:
                    page = doc[page_index]
                try:
                    _fill_empty_ocr_cells(page, tab["rows"], box.table.get("cells"))
                except Exception:
                    pass
            else:
                if page is None:
                    page = doc[page_index]
                hit = _lines_table(page, b["bbox"], cache)
                if hit:
                    tab = {"rows": hit[0], "source": "lines"}
                    b["bbox"] = [round(v, 2) for v in hit[1]]
            b["table"] = tab
        for line in box.textlines or []:
            ln = _line_from_spans(line)
            if ln:
                b["lines"].append(ln)
        out_boxes.append(b)
    return {
        "number": pl.page_number,
        "width": round(pl.width, 2),
        "height": round(pl.height, 2),
        "ocr": page_index in ocr_pages,
        "boxes": out_boxes,
    }


def extract_pages(path: str, pages: list[int], ocr_mode: str = "auto", ocr_dpi: int = 200) -> list[dict]:
    """解析指定页（0 基）。在工作进程中调用。"""
    if _OCR_FUNC is None and ocr_mode != "off":
        worker_init()
    _OCR_PAGES.clear()
    doc = pymupdf.open(path)
    if doc.needs_pass and not doc.authenticate(""):
        raise ValueError("PDF 已加密，无法读取")
    with contextlib.redirect_stdout(io.StringIO()):
        parsed = _parse(doc, pages, ocr_mode, ocr_dpi)
    result = [_convert_page(doc, pl, set(_OCR_PAGES)) for pl in parsed.pages]
    doc.close()
    return result


def document_info(path: str) -> dict:
    doc = pymupdf.open(path)
    if doc.needs_pass and not doc.authenticate(""):
        raise ValueError("PDF 已加密，无法读取")
    info = {
        "page_count": doc.page_count,
        "toc": doc.get_toc(simple=True),
        "title": (doc.metadata or {}).get("title") or "",
        "is_pdf": doc.is_pdf,
    }
    doc.close()
    return info
