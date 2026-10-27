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
NUM_HEADING_RE = re.compile(r"^(\d{1,3})((?:[.．]\d{1,3})*)[.．]?(?=\s|[^\d.．%年月日号个万亿元])")
STRONG_KEYS = {"part", "chapter", "section", "appendix", "cn"}


def numbering_key(text: str):
    for rx, key, rank in HEADING_PATTERNS:
        if rx.match(text):
            return key, rank
    m = NUM_HEADING_RE.match(text)
    if m:
        depth = 1 + m.group(2).count(".") + m.group(2).count("．")
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


def _body_font_size(blocks) -> float:
    cnt = Counter()
    for b in blocks:
        if b["cls"] in ("text", "list-item"):
            for l in b["lines"]:
                cnt[round(l["size"] * 2) / 2] += len(l["text"])
    return cnt.most_common(1)[0][0] if cnt else 10.0


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


def _block_size(b) -> float:
    return max((l["size"] for l in b["lines"]), default=0)


def _block_bold(b) -> bool:
    return bool(b["lines"]) and all(l["bold"] for l in b["lines"])


def _promote_heading(b, body_size, toc_keys) -> bool:
    """正文框是否其实是标题（版面模型漏判）。"""
    text = b["text"]
    if len(b["lines"]) > 2 or not _heading_plausible(text) or len(text) > 40 or ends_sentence(text):
        return False
    key = strip_key(text)
    if key and key in toc_keys.get(b["page"], set()):
        return True
    nkey, _ = numbering_key(text)
    styled = _block_bold(b) or _block_size(b) >= body_size * 1.15
    if nkey in STRONG_KEYS and (styled or len(text) <= 25):
        return True
    return bool(nkey) and nkey.startswith("num-") and nkey != "num-1" and styled


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
        idx = next((i for i, e in enumerate(stack) if e["key"] == key), None)
        if idx is not None:
            del stack[idx + 1 :]
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
            stack.append({"key": key, "rank": rank, "size": h["size"]})
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


def _split_text_block(b):
    """把正文框拆分为段落/列表项：依据首行缩进、短行+句末标点、行首列表标记。"""
    lines = b["lines"]
    if not lines:
        return []
    x0 = min(l["bbox"][0] for l in lines)
    x1 = max(l["bbox"][2] for l in lines)
    groups: list[list[dict]] = []
    for i, ln in enumerate(lines):
        if not groups:
            groups.append([ln])
            continue
        prev = groups[-1][-1]
        size = ln["size"] or 10
        prev_short = prev["bbox"][2] < x1 - 2 * size
        indented = ln["bbox"][0] - x0 > 1.2 * size and ln["bbox"][0] - prev["bbox"][0] > 0.8 * size
        is_marker = _list_marker(ln["text"]) is not None and ln["bbox"][0] - x0 < 3 * size
        new = (indented and (ends_sentence(prev["text"]) or prev_short)) or (prev_short and ends_sentence(prev["text"]))
        if is_marker and (prev_short or ends_sentence(prev["text"])):
            new = True
        if new:
            groups.append([ln])
        else:
            groups[-1].append(ln)
    out = []
    for g in groups:
        text = join_lines([l["text"] for l in g])
        bbox = [min(l["bbox"][0] for l in g), min(l["bbox"][1] for l in g), max(l["bbox"][2] for l in g), max(l["bbox"][3] for l in g)]
        out.append((text, bbox, g[0]["bbox"][0], g[0]["size"]))
    return out


def _is_prose(b) -> bool:
    if len(b["text"]) < 30 or not b["lines"]:
        return False
    return sum(len(l["text"]) for l in b["lines"]) / len(b["lines"]) >= 12


def _make_list_item(text, page, bbox, x0, ocr):
    lm = _list_marker(text)
    if lm:
        marker, ordered, body = lm
    else:
        marker, ordered, body = "-", False, text
    return {"type": "list_item", "text": body, "marker": marker, "ordered": ordered, "x0": x0,
            "pages": [page, page], "bbox": bbox, "ocr": ocr}


def _blocks_to_elements(blocks, body_size, toc_keys, stats):
    elements = []
    for b in blocks:
        cls, page, text = b["cls"], b["page"], b["text"]
        base = {"pages": [page, page], "bbox": b["bbox"], "pw": b["pw"], "ph": b["ph"], "ocr": b["ocr"]}
        if cls == "table":
            raw = (b["table"] or {}).get("rows")
            t = T.normalize_table(raw, b["ocr"])
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
        if cls in ("title", "section-header") or (cls == "text" and _promote_heading(b, body_size, toc_keys)):
            if _heading_plausible(text):
                elements.append({"type": "heading", "text": normalize_heading(text), "size": _block_size(b), **base})
                continue
            if _list_marker(text):
                elements.append(_make_list_item(text, page, b["bbox"], b["bbox"][0], b["ocr"]))
                continue
            cls = "text"
        if cls == "list-item":
            elements.append(_make_list_item(text, page, b["bbox"], b["bbox"][0], b["ocr"]))
        elif cls == "caption":
            elements.append({"type": "paragraph", "text": text, "role": "caption", **base})
        elif cls == "footnote":
            elements.append({"type": "paragraph", "text": text, "role": "footnote", **base})
        elif cls == "code":
            code = "\n".join(l["text"] for l in b["lines"])
            elements.append({"type": "code", "text": code, **base})
        elif cls == "picture":
            if _is_prose(b):
                elements.append({"type": "paragraph", "text": text, "role": None, **base})
        else:  # text / formula / 其他
            for ptext, bbox, x0, size in _split_text_block(b):
                if _list_marker(ptext) and cls == "text":
                    elements.append(_make_list_item(ptext, page, bbox, x0, b["ocr"]))
                else:
                    elements.append({"type": "paragraph", "text": ptext, "role": None, **base, "bbox": bbox, "fs": size})
    return elements


# ---------------------------------------------------------------- 合并


def _is_continuation(prev, nxt) -> bool:
    """prev 段落是否延续到 nxt：跨页（页尾→下页首）或跨栏（栏底→下一栏顶）。"""
    if prev["type"] != "paragraph" or nxt["type"] != "paragraph" or prev.get("role") or nxt.get("role"):
        return False
    if ends_sentence(prev["text"]) or len(prev["text"]) < 15:
        return False
    if _list_marker(nxt["text"]):
        return False
    if nxt["pages"][0] == prev["pages"][1] + 1:
        return prev.get("last_on_page", False) and nxt.get("first_on_page", False)
    if nxt["pages"][0] == prev["pages"][1]:
        pb, nb = prev["bbox"], nxt["bbox"]
        # 版面模型把同一段落切成上下相邻的两个框
        gap_limit = max(1.2 * (nxt.get("fs") or prev.get("fs") or 10), 6)
        if -2 <= nb[1] - pb[3] < gap_limit and abs(nb[0] - pb[0]) < 30 and abs(nb[2] - pb[2]) < 30:
            return True
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


def _group_lists(elements):
    out = []
    for e in elements:
        if e["type"] != "list_item":
            out.append(e)
            continue
        if out and out[-1]["type"] == "list" and out[-1]["pages"][1] in (e["pages"][0], e["pages"][0] - 1):
            lst = out[-1]
        else:
            lst = {"type": "list", "items": [], "pages": list(e["pages"]), "_x0s": []}
            out.append(lst)
        lst["items"].append({"text": e["text"], "marker": e["marker"], "ordered": e["ordered"], "x0": e["x0"]})
        lst["pages"][1] = e["pages"][1]
    for e in out:
        if e["type"] == "list":
            xs = sorted({round(it["x0"] / 6) for it in e["items"]})
            for it in e["items"]:
                it["depth"] = min(xs.index(round(it.pop("x0") / 6)), 3)
            # 缩进层级不能跳级
            prev = 0
            for it in e["items"]:
                it["depth"] = min(it["depth"], prev + 1)
                prev = it["depth"]
            e.pop("_x0s", None)
    return out


# ---------------------------------------------------------------- 入口


def build_elements(pages: list[dict], toc: list | None = None, remove_header_footer: bool = True):
    stats = {"pages": len(pages), "ocr_pages": sum(1 for p in pages if p["ocr"]), "tables": 0,
             "tables_merged": 0, "paragraphs_merged": 0, "removed_header_footer": 0}
    blocks = _collect_blocks(pages)
    blocks = _remove_headers_footers(blocks, len(pages), remove_header_footer, stats)
    body_size = _body_font_size(blocks)
    toc_keys = defaultdict(set)
    for _lvl, title, pg in toc or []:
        for p in (pg - 1, pg, pg + 1):
            toc_keys[p].add(strip_key(title))
    elements = _blocks_to_elements(blocks, body_size, toc_keys, stats)
    headings = [e for e in elements if e["type"] == "heading"]
    assign_heading_levels(headings, toc)
    elements = _merge_across(elements, stats)
    elements = _group_lists(elements)
    for e in elements:
        for k in ("bbox", "pw", "ph", "ocr", "size", "first_on_page", "last_on_page", "fs"):
            e.pop(k, None)
    stats["headings"] = len(headings)
    return elements, stats
