"""把版面分析结果整理为结构化元素：去页眉页脚、标题分级、段落/列表重建、跨页合并。

元素（dict）:
    heading:   {"type", "text", "level", "pages"}
    paragraph: {"type", "text", "role": None|"caption"|"footnote", "pages"}
    list:      {"type", "items": [{"text", "marker", "ordered", "depth"}], "pages"}
    table:     {"type", "header", "rows", "pages"}
    code:      {"type", "text", "pages"}
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from . import tables as T
from .textutil import clean_text, ends_sentence, is_cjk, join_lines, norm_key, strip_key

MARGIN_RATIO = 0.1
CN_NUM = "一二三四五六七八九十百千零〇两"

PAGE_NUM_RE = re.compile(
    r"^(?:[-–—~·•\s]*\d{1,4}[-–—~·•\s]*"
    r"|第\s*\d+\s*页(?:\s*[/，,]?\s*共\s*\d+\s*页)?"
    r"|\d+\s*/\s*\d+"
    r"|(?:page|p\.)\s*\d+(?:\s*(?:of|/)\s*\d+)?"
    r"|[ivxlcdm]{1,6})$",
    re.I,
)

BULLET_RE = re.compile(r"^([•●○◦■□▪▫◆◇►▶➢➤✓✔√·∙\-*–])\s*")
ORDERED_RE = re.compile(r"^(\d{1,3})\s*[.．、)）](?!\d)\s*")
OTHER_MARKER_RE = re.compile(
    rf"^([（(]\s*(?:\d{{1,3}}|[a-zA-Z]|[{CN_NUM}]+)\s*[）)]|[①-⑳]|[a-z][.)]\s|[{CN_NUM}]+、)\s*"
)

# (正则, 键, 级别序号)。序号越小层级越高；数字多级编号的序号随深度递增。
HEADING_PATTERNS = [
    (re.compile(rf"^第\s*[\d{CN_NUM}]+\s*[编篇部](?:分)?"), "part", 0),
    (re.compile(r"^(?:part|PART|Part)\s+[\dIVXivx]+\b"), "part", 0),
    (re.compile(rf"^第\s*[\d{CN_NUM}]+\s*章"), "chapter", 1),
    (re.compile(r"^(?:chapter|CHAPTER|Chapter)\s+\w+"), "chapter", 1),
    (re.compile(r"^(?:附录|附件|Appendix|APPENDIX)"), "appendix", 1),
    (re.compile(rf"^第\s*[\d{CN_NUM}]+\s*节"), "section", 2),
    (re.compile(r"^(?:section|SECTION|Section)\s+\d+"), "section", 2),
    (re.compile(rf"^第\s*[\d{CN_NUM}]+\s*条"), "article", 3),
    (re.compile(rf"^[{CN_NUM}]+\s*[、.．]"), "cn", 3),
    (re.compile(rf"^[（(]\s*[{CN_NUM}]+\s*[）)]"), "cn-paren", 4),
    (re.compile(r"^[A-Z][.．、]\s*\S"), "alpha", 4),
    (re.compile(r"^[（(]\s*\d{1,3}\s*[）)]"), "num-paren", 20),
    (re.compile(r"^\d{1,3}\s*[)）]"), "num-rparen", 20),
    (re.compile(r"^[①-⑳]"), "circled", 21),
]
# 多级数字编号，允许附录字母前缀：1 / 1.2 / 2.3.4 / A1 / C3.11.9.5
NUM_HEADING_RE = re.compile(r"^([A-Z]{1,2})?(\d{1,3})((?:[.．]\d{1,3})*)[.．]?(?=\s|[^\d.．%年月日号个万亿元吨])")
STRONG_KEYS = {"part", "chapter", "section", "appendix", "cn"}


def numbering_key(text: str):
    for rx, key, rank in HEADING_PATTERNS:
        if rx.match(text):
            return key, rank
    m = NUM_HEADING_RE.match(text)
    if m:
        depth = 1 + m.group(3).count(".") + m.group(3).count("．")
        return f"num-{depth}", 4 + depth
    return None, None


def normalize_heading(text: str) -> str:
    text = re.sub(rf"^(第\s*[\d{CN_NUM}]+\s*[编篇部章节条](?:分)?)\s*", lambda m: re.sub(r"\s", "", m.group(1)) + " ", text)
    text = re.sub(r"^(\d{1,3}(?:[.．]\d{1,3})+)\s*(?=[^\d\s.．])", r"\1 ", text)
    text = re.sub(r"^(\d{1,3}[.．])(?=[^\d\s])", r"\1 ", text)
    return text.strip()


# ---------------------------------------------------------------- 预处理


def _block_text_lines(box, ocr):
    out = []
    for ln in box["lines"]:
        t = clean_text(ln["text"], ocr)
        if t:
            out.append({**ln, "text": t})
    return out


def _in_margin(bbox, height):
    return bbox[3] <= height * MARGIN_RATIO + 2 or bbox[1] >= height * (1 - MARGIN_RATIO) - 2


def _collect_blocks(pages):
    blocks = []
    for p in pages:
        for order, box in enumerate(p["boxes"]):
            lines = _block_text_lines(box, p["ocr"])
            blocks.append(
                {
                    "page": p["number"],
                    "pw": p["width"],
                    "ph": p["height"],
                    "ocr": p["ocr"],
                    "cls": box["cls"],
                    "bbox": box["bbox"],
                    "lines": lines,
                    "text": join_lines([l["text"] for l in lines]),
                    "table": box["table"],
                    "order": order,
                }
            )
    return blocks


def _remove_headers_footers(blocks, n_pages, enabled: bool, stats: dict):
    if not enabled:
        for b in blocks:
            if b["cls"] in ("page-header", "page-footer"):
                b["cls"] = "text"
        return blocks
    # 边缘区域内跨页重复出现的文字
    occurrences = defaultdict(set)
    for b in blocks:
        if b["cls"] != "table" and b["text"] and _in_margin(b["bbox"], b["ph"]):
            occurrences[norm_key(b["text"])].add(b["page"])
    threshold = max(2, math.ceil(n_pages * 0.3))
    repeated = {k for k, pg in occurrences.items() if k and len(pg) >= threshold} if n_pages >= 2 else set()
    kept = []
    removed = 0
    for b in blocks:
        drop = b["cls"] in ("page-header", "page-footer")
        if not drop and b["cls"] != "table" and b["text"] and _in_margin(b["bbox"], b["ph"]):
            if norm_key(b["text"]) in repeated or PAGE_NUM_RE.match(b["text"].strip()):
                drop = True
        if drop:
            removed += 1
        else:
            kept.append(b)
    stats["removed_header_footer"] = removed
    return kept


# ---------------------------------------------------------------- 标题


def _heading_plausible(text: str) -> bool:
    if not text or len(text) > 80:
        return False
    cjk = sum(1 for c in text if is_cjk(c))
    if cjk > len(text) / 2 and len(text) > 50:
        return False
    if text[-1] in "，,、；;":
        return False
    if text.endswith(("。", "！", "？", "；")) and (numbering_key(text)[0] is None or len(text) > 20):
        return False
    if text.endswith(".") and len(text) > 30:
        return False
    if BULLET_RE.match(text) and not text.startswith("-"):
        return False
    if re.fullmatch(r"[\d\W_]+", text):
        return False
    return True


def _same_size(a, b) -> bool:
    return abs(a - b) <= max(0.6, 0.12 * max(a, b))


def assign_heading_levels(headings: list[dict], toc: list | None = None):
    """按“编号体例 + 出现顺序 + 字号”推断层级；有书签目录时以目录校正。"""
    size_clusters: list[float] = []

    def size_key(size):
        for s in size_clusters:
            if _same_size(s, size):
                return f"size:{s}"
        size_clusters.append(size)
        return f"size:{size}"

    stack: list[dict] = []
    for h in headings:
        key, rank = numbering_key(h["text"])
        if key is None:
            key = size_key(h["size"])
        # 与仍在栈中的标题同名（如封面标题在正文首页重复出现）：视为同一层级
        tkey = strip_key(h["text"])
        idx = next((i for i, e in enumerate(stack) if e.get("text") == tkey), None)
        if idx is None:
            idx = next((i for i, e in enumerate(stack) if e["key"] == key), None)
        if idx is not None:
            del stack[idx + 1 :]
            stack[idx]["text"] = tkey
            level = idx + 1
        else:
            while stack:
                top = stack[-1]
                if top["rank"] is not None and rank is not None:
                    pop = top["rank"] >= rank
                else:
                    pop = not (top["size"] > h["size"] and not _same_size(top["size"], h["size"]))
                if not pop:
                    break
                stack.pop()
            stack.append({"key": key, "rank": rank, "size": h["size"], "text": tkey})
            level = len(stack)
        h["level"] = level

    if toc and len(toc) >= 3:
        toc_level = {}
        for lvl, title, _page in toc:
            toc_level.setdefault(strip_key(title), lvl)
        matched = [h for h in headings if strip_key(h["text"]) in toc_level]
        if len(matched) >= max(2, len(toc_level) * 0.3):
            anchor = None
            for h in headings:
                k = strip_key(h["text"])
                if k in toc_level:
                    anchor = (toc_level[k], h["level"])
                    h["level"] = toc_level[k]
                elif anchor:
                    h["level"] = max(1, anchor[0] + (h["level"] - anchor[1]))
    for h in headings:
        h["level"] = max(1, min(6, h["level"]))


# ---------------------------------------------------------------- 段落与列表


def _list_marker(text: str):
    """识别列表标记，返回 (marker, ordered, 正文)；非列表返回 None。"""
    m = BULLET_RE.match(text)
    if m and len(text) > len(m.group(0)):
        if m.group(1) in "-*–" and not text[len(m.group(1)) : len(m.group(1)) + 1].isspace():
            return None
        return "-", False, text[m.end() :].strip()
    m = ORDERED_RE.match(text)
    if m and len(text) > m.end():
        return f"{int(m.group(1))}.", True, text[m.end() :].strip()
    m = OTHER_MARKER_RE.match(text)
    if m and len(text) > m.end():
        return m.group(1).strip(), False, text[m.end() :].strip()
    return None


def _is_prose(b) -> bool:
    if len(b["text"]) < 30 or not b["lines"]:
        return False
    return sum(len(l["text"]) for l in b["lines"]) / len(b["lines"]) >= 12


def _make_list_item(text, page, bbox, size=None, ph=None):
    lm = _list_marker(text)
    if lm:
        marker, ordered, body = lm
    else:
        marker, ordered, body = "-", False, text
    return {"type": "list_item", "text": body, "marker": marker, "ordered": ordered,
            "pages": [page, page], "bbox": bbox, "fs": size, "ph": ph}


CAPTION_LINE_RE = re.compile(r"^(续?表|图|Table|TABLE|Fig\.?|Figure)\s*[A-Za-z]{0,3}\s*[-－—.]?\s*\d")
TOC_LINE_RE = re.compile(r"(?:[.·…‥・_]\s*){5,}\s*[(（]?\s*\d+\s*[)）]?\s*$")
TOC_TITLE_RE = re.compile(r"^(目录|contents|tableofcontents)$", re.I)
ARTICLE_RE = re.compile(rf"^(第[\d{CN_NUM}]+[条款])\s*(?=\S)")
TEXT_CLASSES = {"text", "list-item", "title", "section-header", "formula"}


class BodyStyle:
    """正文主样式（字号、是否粗体），用于判断“与正文不同”的标题行。"""

    def __init__(self, blocks):
        sizes = Counter()
        bold = total = 0
        for b in blocks:
            if b["cls"] in ("text", "list-item"):
                for l in b["lines"]:
                    n = len(l["text"])
                    sizes[round(l["size"] * 2) / 2] += n
                    total += n
                    bold += n if l["bold"] else 0
        self.size = sizes.most_common(1)[0][0] if sizes else 10.0
        self.bold = total > 0 and bold / total > 0.5

    def emphasized(self, line) -> bool:
        return line["size"] >= self.size * 1.12 or (line["bold"] and not self.bold)


def _norm_para(text: str) -> str:
    return ARTICLE_RE.sub(r"\1 ", text)


class _Flow:
    """同一页同一栏内连续的文字框。

    版面模型常把标题行与正文、或多条条款框在一起，这里把框内的行重新组织为
    标题 / 段落 / 列表项：依据首行缩进、上一行是否写满、句末标点、行首编号与字体变化。
    """

    def __init__(self, page, ph, style: BodyStyle, toc_keys):
        self.page, self.ph, self.style, self.toc_keys = page, ph, style, toc_keys
        self.lines: list[dict] = []
        self.last_bbox = None

    def accepts(self, b) -> bool:
        if b["page"] != self.page:
            return False
        lb = self.last_bbox
        # 向上跳且移到右侧：换栏
        return not (b["bbox"][1] < lb[1] - 5 and b["bbox"][0] > lb[2] - 5)

    def add(self, b):
        hint = b["cls"] in ("title", "section-header")
        for l in b["lines"]:
            if not TOC_LINE_RE.search(l["text"]):
                self.lines.append({**l, "hint": hint})
        self.last_bbox = b["bbox"]

    def _heading_line(self, l) -> bool:
        text = l["text"]
        # PDF 书签目录中的条目优先认定为标题
        if len(text) <= 120 and strip_key(text) in self.toc_keys.get(self.page, set()):
            return True
        if not _heading_plausible(text) or len(text) > 50 or CAPTION_LINE_RE.match(text):
            return False
        if text.endswith(("：", ":")):
            return False
        key, _ = numbering_key(text)
        if key == "appendix" and re.match(r"^(附件|附录)\s*[\d一二三四五六七八九十A-Z]*\s*[：:]\s*\S", text):
            return False
        styled = self.style.emphasized(l)
        if key in ("num-paren", "num-rparen", "circled", "article"):
            return l["hint"] and styled and len(text) <= 20
        if key:
            if styled or (l["hint"] and len(text) <= 30):
                return True
            # 仅编号使用粗体（如“1.2 适用范围”中“1.2”为黑体）的独立短行
            if l.get("lead_bold") and not self.style.bold and len(text) <= 30 and not ends_sentence(text):
                return True
            return key in STRONG_KEYS and len(text) <= 25 and not ends_sentence(text)
        # 无编号：须与正文样式不同，且较短
        return styled and len(text) <= 30

    def _para_break(self, p, l, left, right, width) -> bool:
        """上一行 p 与本行 l 之间是否分段。"""
        size = l["size"] or 10
        text, ptext = l["text"], p["text"]
        if abs(p["size"] - l["size"]) > max(1.0, 0.15 * p["size"]) or p["bold"] != l["bold"]:
            return True
        if l["bbox"][1] - p["bbox"][3] > 1.2 * size:
            return True
        indented = l["bbox"][0] - left > 1.2 * size
        p_end = ends_sentence(ptext)
        p_short = p["bbox"][2] < right - max(1.5 * size, 0.12 * width)
        p_very_short = p["bbox"][2] < right - 0.35 * width
        starts_item = bool(_list_marker(text) or ARTICLE_RE.match(text)) or numbering_key(text)[0] in STRONG_KEYS
        if (starts_item or indented) and (p_end or p_short):
            return True
        if p_short and p_end:
            return True
        return p_very_short and not ptext.endswith(("，", ","))

    def build(self) -> list[dict]:
        lines = self.lines
        if not lines:
            return []
        xs = sorted(l["bbox"][0] for l in lines)
        left = xs[len(xs) // 10]
        right = max(l["bbox"][2] for l in lines)
        width = max(right - left, 1)
        out: list[dict] = []
        para: list[dict] = []
        head: list[dict] = []  # 正在拼接的（可能多行的）标题

        def flush_para():
            if not para:
                return
            text = _norm_para(join_lines([l["text"] for l in para]))
            bbox = [min(l["bbox"][0] for l in para), para[0]["bbox"][1],
                    max(l["bbox"][2] for l in para), para[-1]["bbox"][3]]
            size = para[0]["size"]
            if _list_marker(text):
                out.append(_make_list_item(text, self.page, bbox, size, self.ph))
            else:
                role = "caption" if CAPTION_LINE_RE.match(text) and len(text) <= 60 else None
                out.append({"type": "paragraph", "text": text, "role": role, "pages": [self.page, self.page],
                            "bbox": bbox, "fs": size, "ph": self.ph})
            para.clear()

        def flush_head():
            if not head:
                return
            text = normalize_heading(join_lines([l["text"] for l in head]))
            if not TOC_TITLE_RE.match(strip_key(text)):
                bbox = [min(l["bbox"][0] for l in head), head[0]["bbox"][1],
                        max(l["bbox"][2] for l in head), head[-1]["bbox"][3]]
                out.append({"type": "heading", "text": text, "size": max(l["size"] for l in head),
                            "pages": [self.page, self.page], "bbox": bbox, "ph": self.ph})
            head.clear()

        for l in lines:
            p = para[-1] if para else None
            continues = p is not None and not self._para_break(p, l, left, right, width)
            if not continues and self._heading_line(l):
                h = head[-1] if head else None
                # 标题折行：同样式、紧邻、且下一行没有新编号
                wrapped = (h is not None and numbering_key(l["text"])[0] is None and _same_size(h["size"], l["size"])
                           and h["bold"] == l["bold"] and -2 <= l["bbox"][1] - h["bbox"][3] < 1.2 * (l["size"] or 10))
                if not wrapped:
                    flush_head()
                flush_para()
                head.append(l)
                continue
            flush_head()
            if not continues:
                flush_para()
            para.append(l)
        flush_head()
        flush_para()
        return out


def _is_toc_table(raw) -> bool:
    """被识别为表格的目录页：多数行带点线引导符和页码。"""
    rows = [" ".join(c or "" for c in r) for r in raw or []]
    rows = [r for r in rows if r.strip()]
    return bool(rows) and sum(1 for r in rows if TOC_LINE_RE.search(r.replace("\n", " ").strip())) >= len(rows) / 2


def _blocks_to_elements(blocks, style: BodyStyle, toc_keys, stats):
    elements = []
    flow: _Flow | None = None

    def close_flow():
        nonlocal flow
        if flow is not None:
            elements.extend(flow.build())
        flow = None

    for b in blocks:
        cls, page, text = b["cls"], b["page"], b["text"]
        if cls in TEXT_CLASSES:
            if not b["lines"]:
                continue
            if flow is None or not flow.accepts(b):
                close_flow()
                flow = _Flow(page, b["ph"], style, toc_keys)
            flow.add(b)
            continue
        close_flow()
        base = {"pages": [page, page], "bbox": b["bbox"], "pw": b["pw"], "ph": b["ph"], "ocr": b["ocr"]}
        if cls == "table":
            raw = (b["table"] or {}).get("rows")
            if _is_toc_table(raw):
                stats["toc_removed"] = stats.get("toc_removed", 0) + 1
                continue
            t = T.normalize_table(raw, b["ocr"], (b["table"] or {}).get("col_x"))
            if t:
                elements.append({"type": "table", **t, "row_pages": [page] * len(t["rows"]), **base})
                stats["tables"] += 1
            else:
                txt = T.table_as_text(raw, b["ocr"])
                if txt:
                    elements.append({"type": "paragraph", "text": txt.replace("\n", " "), "role": None, **base})
            continue
        if not text:
            continue
        if cls == "caption":
            elements.append({"type": "paragraph", "text": text, "role": "caption", **base})
        elif cls == "footnote":
            elements.append({"type": "paragraph", "text": text, "role": "footnote", **base})
        elif cls == "code":
            elements.append({"type": "code", "text": "\n".join(l["text"] for l in b["lines"]), **base})
        elif cls == "picture":
            if _is_prose(b):
                elements.append({"type": "paragraph", "text": text, "role": None, **base})
        else:
            elements.append({"type": "paragraph", "text": text, "role": None, **base})
    close_flow()
    return elements


# ---------------------------------------------------------------- 合并


def _is_continuation(prev, nxt) -> bool:
    """prev 段落/列表项是否延续到 nxt：跨页（页尾→下页首）或跨栏（栏底→下一栏顶）。"""
    if prev["type"] not in ("paragraph", "list_item") or nxt["type"] != "paragraph":
        return False
    if prev.get("role") or nxt.get("role"):
        return False
    if ends_sentence(prev["text"]) or len(prev["text"]) < 15:
        return False
    if _list_marker(nxt["text"]):
        return False
    if nxt["pages"][0] == prev["pages"][1] + 1:
        return prev.get("last_on_page", False) and nxt.get("first_on_page", False)
    if nxt["pages"][0] == prev["pages"][1]:
        pb, nb = prev["bbox"], nxt["bbox"]
        # 跨栏：上一栏底部 → 下一栏顶部
        ph = prev.get("ph") or 842
        return pb[3] > ph * 0.7 and nb[1] < pb[1] - 20 and nb[0] > pb[0] + 50
    return False


def _mark_page_edges(elements):
    by_page = defaultdict(list)
    for i, e in enumerate(elements):
        if not (e["type"] == "paragraph" and e.get("role") == "footnote"):
            by_page[e["pages"][0]].append(i)
    for idxs in by_page.values():
        elements[idxs[0]]["first_on_page"] = True
        elements[idxs[-1]]["last_on_page"] = True


CONT_TABLE_RE = re.compile(r"^[(（]?\s*(续表|续上表|接上表|表\s*\S*\s*[(（]?续[)）]?)")


def _merge_across(elements, stats):
    _mark_page_edges(elements)
    out: list[dict] = []
    pending_footnotes: list[dict] = []

    def last_body():
        for e in reversed(out):
            if not (e["type"] == "paragraph" and e.get("role") == "footnote"):
                return e
        return None

    i = 0
    while i < len(elements):
        e = elements[i]
        prev = last_body()
        # “续表”提示行：若其后紧跟表格且能与上一表合并，则丢弃
        if (e["type"] == "paragraph" and len(e["text"]) <= 30 and CONT_TABLE_RE.match(e["text"])
                and i + 1 < len(elements) and elements[i + 1]["type"] == "table" and prev and prev["type"] == "table"):
            i += 1
            continue
        # 上一页最后一个正文元素是表格、本页第一个元素也是表格 → 跨页表格
        if e["type"] == "table" and prev is not None and prev["type"] == "table":
            if e["pages"][0] == prev["pages"][1] + 1 and T.can_merge(prev, e):
                merged = T.merge_tables(prev, e)
                prev.update(merged)
                prev["pages"] = [prev["pages"][0], e["pages"][1]]
                stats["tables_merged"] += 1
                i += 1
                continue
        if prev is not None and _is_continuation(prev, e):
            joined = join_lines([prev["text"], e["text"]])
            marks = prev.setdefault("page_marks", [[0, prev["pages"][0]]])
            if e["pages"][0] != marks[-1][1]:
                marks.append([max(0, len(joined) - len(e["text"])), e["pages"][0]])
            prev["text"] = joined
            prev["pages"] = [prev["pages"][0], e["pages"][1]]
            prev["bbox"] = e["bbox"]
            prev["last_on_page"] = e.get("last_on_page", False)
            stats["paragraphs_merged"] += 1
            # 夹在中间的脚注移到合并段落之后
            if out[-1] is not prev:
                idx = out.index(prev)
                pending_footnotes.extend(out[idx + 1 :])
                del out[idx + 1 :]
            i += 1
            continue
        if pending_footnotes and e["type"] != "paragraph":
            out.extend(pending_footnotes)
            pending_footnotes = []
        out.append(e)
        if pending_footnotes:
            out.extend(pending_footnotes)
            pending_footnotes = []
        i += 1
    out.extend(pending_footnotes)
    return out


def _marker_style(marker: str) -> str:
    if marker == "-":
        return "bullet"
    if re.fullmatch(r"\d+\.", marker):
        return "num"
    if re.match(r"[（(]\s*\d", marker):
        return "paren-num"
    if re.match(rf"[（(]\s*[{CN_NUM}]", marker):
        return "paren-cn"
    if re.match(r"[（(]\s*[a-zA-Z]", marker) or re.match(r"[a-z][.)]", marker):
        return "alpha"
    if re.match(r"[①-⑳]", marker):
        return "circled"
    return "cn" if marker.endswith("、") else "other"


def _group_lists(elements):
    """相邻列表项合为列表；嵌套层级按编号样式的出现顺序推断（如 1. → (1) → ①）。"""
    out = []
    for e in elements:
        if e["type"] != "list_item":
            out.append(e)
            continue
        if out and out[-1]["type"] == "list" and out[-1]["pages"][1] in (e["pages"][0], e["pages"][0] - 1):
            lst = out[-1]
        else:
            lst = {"type": "list", "items": [], "pages": list(e["pages"])}
            out.append(lst)
        lst["items"].append({"text": e["text"], "marker": e["marker"], "ordered": e["ordered"]})
        lst["pages"][1] = e["pages"][1]
    for e in out:
        if e["type"] != "list":
            continue
        stack: list[str] = []
        for it in e["items"]:
            st = _marker_style(it["marker"])
            if st in stack:
                del stack[stack.index(st) + 1 :]
            else:
                stack.append(st)
            it["depth"] = min(len(stack) - 1, 3)
    return out


# ---------------------------------------------------------------- 入口


def build_elements(pages: list[dict], toc: list | None = None, remove_header_footer: bool = True):
    stats = {"pages": len(pages), "ocr_pages": sum(1 for p in pages if p["ocr"]), "tables": 0,
             "tables_merged": 0, "paragraphs_merged": 0, "removed_header_footer": 0}
    blocks = _collect_blocks(pages)
    blocks = _remove_headers_footers(blocks, len(pages), remove_header_footer, stats)
    style = BodyStyle(blocks)
    toc_keys = defaultdict(set)
    for _lvl, title, pg in toc or []:
        for p in (pg - 1, pg, pg + 1):
            toc_keys[p].add(strip_key(title))
    elements = _blocks_to_elements(blocks, style, toc_keys, stats)
    headings = [e for e in elements if e["type"] == "heading"]
    assign_heading_levels(headings, toc)
    elements = _merge_across(elements, stats)
    elements = _group_lists(elements)
    for e in elements:
        for k in ("bbox", "pw", "ph", "ocr", "size", "first_on_page", "last_on_page", "fs", "col_x"):
            e.pop(k, None)
    stats["headings"] = len(headings)
    return elements, stats
