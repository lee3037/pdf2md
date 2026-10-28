"""OXR 整份文档 HTTP 后端；保留服务的块顺序，不伪造行级版面信息。"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import httpx

from .. import extract, structure, tables
from .base import ParsedDocument
from .html_table import parse_html_table

DEFAULT_BASE_URL = "https://free-oxr.somark.ai/api/v1"
DEFAULT_TIMEOUT = 300.0
BLOCK_CLASSES = {
    "Text": "text", "Title": "title", "Caption": "caption", "Footnote": "footnote",
    "Page-header": "page-header", "Page-footer": "page-footer", "Stamp": "text",
    "Table": "table", "Formula": "formula", "Chemical Equation": "formula",
    "Code Block": "code", "Picture": "picture", "Chemical Structure": "chemical-structure",
}


class OXRParseError(ValueError):
    """可直接展示给用户的服务或响应错误。"""


def _positive_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _blocks(output: dict, page_count: int) -> list[dict]:
    if not isinstance(output, dict) or not isinstance(output.get("pages"), list):
        raise OXRParseError("OXR 响应缺少 JSON pages，无法解析文档")
    pages = output["pages"]
    if len(pages) != page_count:
        raise OXRParseError("OXR 返回的页数与 PDF 不一致，无法确认文档完整性")
    blocks = []
    for page_index, page in enumerate(pages):
        if not isinstance(page, dict) or type(page.get("page_num")) is not int or page["page_num"] != page_index:
            raise OXRParseError("OXR 响应的页码无效或顺序不完整")
        size = page.get("page_size")
        if not isinstance(size, dict) or not all(_positive_number(size.get(k)) for k in ("w", "h")):
            raise OXRParseError("OXR 响应的页面尺寸无效")
        if not isinstance(page.get("blocks"), list):
            raise OXRParseError("OXR 响应缺少页面 blocks")
        for block in page["blocks"]:
            if not isinstance(block, dict) or not isinstance(block.get("type"), str):
                raise OXRParseError("OXR 响应的内容块结构无效")
            kind = block["type"]
            if kind not in BLOCK_CLASSES:
                raise OXRParseError(f"OXR 返回了暂不支持的内容类型：{kind}")
            bbox = block.get("bbox")
            if (not isinstance(bbox, list) or len(bbox) != 4
                    or any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in bbox)
                    or bbox[2] < bbox[0] or bbox[3] < bbox[1]):
                raise OXRParseError("OXR 响应的块坐标无效")
            if not isinstance(block.get("content"), str):
                raise OXRParseError("OXR 响应的内容块缺少文本 content")
            blocks.append({"cls": BLOCK_CLASSES[kind], "text": block["content"].strip(),
                           "format": block.get("format"), "page": page_index + 1,
                           "bbox": bbox, "ph": size["h"]})
        # 官方序列化器把失去公式归属的编号放在独立字段，保留为页末注释。
        notes = page.get("unattached_formula_numbering", [])
        if not isinstance(notes, list):
            raise OXRParseError("OXR 响应的未关联公式编号无效")
        for note in notes:
            if not isinstance(note, dict) or not isinstance(note.get("content"), str):
                raise OXRParseError("OXR 响应的未关联公式编号无效")
            blocks.append({"cls": "formula-note", "text": note["content"].strip(),
                           "page": page_index + 1})
    return blocks


def _code_element(text: str, pages: list[int]) -> dict:
    # 服务通常已经输出 Markdown 围栏；移除外层后交给统一渲染器。
    match = re.fullmatch(r"(`{3,}|~{3,})([^\n]*)\n(.*?)\n\1\s*", text, re.S)
    language = ""
    if match:
        language = match.group(2).strip()
        text = match.group(3)
    return {"type": "code", "text": text, "language": language, "pages": pages}


def adapt_output(output: dict, info: dict, remove_header_footer: bool) -> ParsedDocument:
    blocks = _blocks(output, info["page_count"])
    stats = {"pages": info["page_count"], "ocr_pages": info["page_count"], "tables": 0,
             "tables_merged": 0, "paragraphs_merged": 0, "removed_header_footer": 0}
    # 仅用真实块坐标删除页边重复文字，不把它们当作文字行坐标。
    # 已确认的标题、公式、代码和表格不参加“重复文字/页码”猜测。
    notes = [b for b in blocks if b["cls"] == "formula-note"]
    margin_classes = {"text", "caption", "footnote", "page-header", "page-footer"}
    candidates = [b for b in blocks if b["cls"] in margin_classes]
    kept = (structure.remove_headers_footers(candidates, stats["pages"], True, stats)
            if remove_header_footer else candidates)
    removed_ids = {id(b) for b in candidates} - {id(b) for b in kept}
    elements, warnings = [], []
    if notes:
        warnings.append("OXR 返回了未关联到公式的编号，已保留为对应页的脚注。")
    image_pages = set()
    for block in blocks:
        if id(block) in removed_ids:
            continue
        cls, text, page = block["cls"], block["text"], block["page"]
        pages = [page, page]
        base = {"pages": pages}
        if cls == "picture":
            image_pages.add(page)
            continue
        if cls == "chemical-structure" and ("![" in text or "<img" in text):
            image_pages.add(page)
            continue
        if not text:
            if cls in ("table", "formula"):
                raise OXRParseError(f"OXR 第 {page} 页返回了空的表格或公式内容，无法确认解析结果")
            continue
        if cls == "title":
            # type 已经表达标题语义，不用正文长度、粗体或字号再次否决。
            title = re.sub(r"^#{1,6}\s+", "", text)
            elements.append({"type": "heading", "text": structure.normalize_heading(title), **base})
        elif cls == "table":
            if block["format"] != "html":
                raise OXRParseError("OXR 未按请求返回 HTML 表格，无法解析表格")
            parsed_table = parse_html_table(text)
            grid = parsed_table.rows
            if parsed_table.has_images:
                image_pages.add(page)
            table = tables.normalize_table(grid, explicit_grid=True, header_rows=parsed_table.header_rows)
            if table:
                elements.append({"type": "table", **table, "row_pages": [page] * len(table["rows"]), **base})
                stats["tables"] += 1
            else:
                table_text = tables.table_as_text(grid)
                if not table_text:
                    raise OXRParseError(f"OXR 第 {page} 页返回了空的 HTML 表格，无法确认解析结果")
                elements.extend(structure.semantic_text_elements(table_text, pages))
        elif cls == "formula":
            if block["format"] != "latex":
                raise OXRParseError("OXR 未按请求返回 LaTeX 公式，无法解析公式")
            elements.append({"type": "formula", "text": text, **base})
        elif cls == "code":
            elements.append(_code_element(text, pages))
        else:
            role = {"caption": "caption", "footnote": "footnote", "formula-note": "footnote",
                    "page-header": "page-header", "page-footer": "page-footer"}.get(cls)
            elements.extend(structure.semantic_text_elements(text, pages, role))
    if image_pages:
        warnings.append("OXR 图片内容未导出，涉及页码：" + "、".join(map(str, sorted(image_pages))) + "。")
    if not elements:
        raise OXRParseError("OXR 未返回可用的文本、表格或公式，请确认文件内容及服务响应")
    elements, stats = structure.finalize_elements(elements, stats, info.get("toc"))
    return ParsedDocument(elements, stats, warnings)


class OXRParser:
    id = "oxr"
    name = "OXR"
    local_ocr_options = False
    uses_local_workers = False

    def __init__(self, transport: httpx.BaseTransport | None = None):
        self._transport = transport

    def _request(self, path: str) -> dict:
        base_url = os.environ.get("STRATUM_OXR_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
        api_key = os.environ.get("STRATUM_OXR_API_KEY", "dummy")
        try:
            timeout = float(os.environ.get("STRATUM_OXR_TIMEOUT", str(DEFAULT_TIMEOUT)))
        except ValueError as exc:
            raise OXRParseError("STRATUM_OXR_TIMEOUT 必须是大于 0 的秒数") from exc
        if not math.isfinite(timeout) or timeout <= 0:
            raise OXRParseError("STRATUM_OXR_TIMEOUT 必须是大于 0 的秒数")
        data = {"api_key": api_key, "output_formats": "json",
                "feature_config": json.dumps({"keep_header_footer": True}),
                "element_formats": json.dumps({"table": "html", "image": "none", "formula": "latex"})}
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout, connect=min(timeout, 30)),
                              transport=self._transport) as client, open(path, "rb") as file:
                response = client.post(base_url + "/parse/sync", data=data,
                                       files={"file": (Path(path).name, file, "application/pdf")})
        except httpx.TimeoutException as exc:
            raise OXRParseError(f"OXR 请求超时（{timeout:g} 秒），服务可能仍在排队或解析，请稍后重试") from exc
        except httpx.RequestError as exc:
            raise OXRParseError("无法连接 OXR 服务，请检查服务器网络与 STRATUM_OXR_BASE_URL 配置") from exc
        try:
            payload = response.json()
        except ValueError:
            payload = None
        message = payload.get("message") if isinstance(payload, dict) else None
        known_free = base_url in (DEFAULT_BASE_URL, "https://free-oxr.somark.cn/api/v1")
        if response.status_code == 413 or message == "file too large":
            limit = "官方免费 OXR 单文件不超过 10 MB、单请求不超过 20 页。" if known_free else "文件超过 OXR 服务大小上限。"
            raise OXRParseError("OXR 服务拒绝了文件：" + limit + "请缩小 PDF 后重试。")
        if message == "file exceeds limit":
            limit = "官方免费 OXR 单请求不超过 20 页、单文件不超过 10 MB。" if known_free else "文件超过 OXR 服务限制。"
            raise OXRParseError("OXR 服务拒绝了文件：" + limit + "请减少页数或缩小 PDF 后重试。")
        if response.status_code in (408, 504):
            raise OXRParseError(f"OXR 服务排队或解析超时（HTTP {response.status_code}），请稍后重试")
        if response.status_code == 429:
            raise OXRParseError("OXR 服务请求过多（HTTP 429），请稍后重试")
        if not response.is_success:
            raise OXRParseError(f"OXR 服务请求失败（HTTP {response.status_code}）")
        if payload is None:
            raise OXRParseError("OXR 未返回有效的 JSON 响应")
        if not isinstance(payload, dict) or type(payload.get("code")) is not int:
            raise OXRParseError("OXR 响应缺少有效的业务状态码 code")
        if payload["code"] != 0:
            message = payload.get("message") or "服务未提供错误说明"
            raise OXRParseError(f"OXR 解析失败（code {payload['code']}）：{message}")
        return payload

    def parse(self, path, options, executor=None, workers=1, progress=None) -> ParsedDocument:
        info = extract.document_info(path)
        if info["page_count"] == 0:
            raise OXRParseError("PDF 没有页面")
        if progress:
            progress(0, info["page_count"])
        payload = self._request(path)
        data = payload.get("data")
        if not isinstance(data, dict):
            raise OXRParseError("OXR 未返回成功的解析结果：data 无效")
        if data.get("error"):
            raise OXRParseError("OXR 未返回成功的解析结果：" + str(data["error"]))
        result = data.get("result")
        outputs = result.get("outputs") if isinstance(result, dict) else None
        if not isinstance(outputs, dict):
            raise OXRParseError("OXR 响应缺少解析结果 outputs")
        parsed = adapt_output(outputs.get("json"), info, options.remove_header_footer)
        warnings = payload.get("warnings", [])
        if not isinstance(warnings, list) or any(not isinstance(w, str) for w in warnings):
            raise OXRParseError("OXR 响应的 warnings 格式无效")
        parsed.warnings = ["OXR：" + w for w in warnings] + parsed.warnings
        if progress:
            progress(info["page_count"], info["page_count"])
        return parsed
