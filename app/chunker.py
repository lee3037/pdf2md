"""按章节与语义边界把结构化元素切成知识块，并拼接为带分隔符的 Markdown。"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from . import tables as T
from .textutil import hard_split

DEFAULT_SEPARATOR = "===CHUNK==="
CAPTION_RE = re.compile(r"^(表|Table|TABLE|Tab\.)\s*[\dA-Z一二三四五六七八九十]")


@dataclass
class ChunkOptions:
    separator: str = DEFAULT_SEPARATOR
    max_chars: int = 1000
    min_chars: int = 200
    context: str = "breadcrumb"  # breadcrumb | headings | none
    include_pages: bool = True
    table_mode: str = "markdown"  # markdown | kv
    table_max_rows: int = 0  # 0 = 只按字数拆分

    @classmethod
    def from_dict(cls, d: dict | None) -> "ChunkOptions":
        d = d or {}
        o = cls()
        for k in asdict(o):
            if k in d and d[k] is not None:
                setattr(o, k, type(getattr(o, k))(d[k]))
        o.max_chars = max(100, o.max_chars)
        o.min_chars = max(0, min(o.min_chars, o.max_chars // 2))
        o.table_max_rows = max(0, o.table_max_rows)
        if o.context not in ("breadcrumb", "headings", "none"):
            o.context = "breadcrumb"
        if o.table_mode not in ("markdown", "kv"):
            o.table_mode = "markdown"
        if not o.separator.strip():
            o.separator = DEFAULT_SEPARATOR
        return o


# ---------------------------------------------------------------- 渲染单个元素


def _md_paragraph(text: str) -> str:
    # 避免正文开头被误解析成标题/引用
    return re.sub(r"^([#>])", r"\\\1", text)


def _md_list_lines(items) -> list[str]:
    lines = []
    for it in items:
        marker = it["marker"]
        if marker != "-" and not re.fullmatch(r"\d+\.", marker):
            body = f"- {marker} {it['text']}"
        else:
            body = f"{marker} {it['text']}"
        lines.append("    " * it.get("depth", 0) + body)
    return lines


def _fmt_pages(pages) -> str:
    a, b = pages
    return f"{a}" if a == b else f"{a}-{b}"


# ---------------------------------------------------------------- 章节与单元


class Unit:
    """brk=True：表格续块，必须另起一块（保证“每块最多 N 行”生效）。"""

    __slots__ = ("md", "pages", "glue", "kind", "brk")

    def __init__(self, md, pages, glue=False, kind="text", brk=False):
        self.md, self.pages, self.glue, self.kind, self.brk = md, list(pages), glue, kind, brk


def _sections(elements):
    """按标题切分章节，path 为 [(level, text), ...]（含自身标题）。"""
    sections = []
    stack: list[tuple[int, str]] = []
    cur = {"path": [], "heading": None, "elements": []}
    for e in elements:
        if e["type"] == "heading":
            if cur["heading"] or cur["elements"]:
                sections.append(cur)
            while stack and stack[-1][0] >= e["level"]:
                stack.pop()
            stack.append((e["level"], e["text"]))
            cur = {"path": list(stack), "heading": e, "elements": []}
        else:
            cur["elements"].append(e)
    if cur["heading"] or cur["elements"]:
        sections.append(cur)
    return sections


def _table_units(e, caption, budget, opts, first_budget=None) -> list[Unit]:
    header, rows = e["header"], e["rows"]
    mode = opts.table_mode
    row_md = [T.render(header, [r], mode).split("\n")[-1] for r in rows]
    head_md = "" if mode == "kv" else T.render_markdown(header, [])
    row_pages = e.get("row_pages") or [None] * len(rows)
    units, group, gpages = [], [], []

    def flush(first):
        # 续块重复表名（和表头），保证拆开后仍能独立理解
        cap = caption if first else (f"{caption}（续）" if caption else "（续表）")
        if mode == "kv":
            md = "\n\n".join(p for p in (cap, "\n".join(group)) if p)
        else:
            table = head_md + ("\n" + "\n".join(group) if group else "")
            md = f"{cap}\n\n{table}" if cap else table
        ps = [p for p in gpages if p] or e["pages"]
        units.append(Unit(md, [min(ps), max(ps)], kind="table", brk=not first))

    fixed = len(caption or "（续表）") + len(head_md) + 8
    size = fixed
    for line, rp in zip(row_md, row_pages):
        limit = budget if units else (first_budget or budget)
        too_big = group and size + len(line) + 1 > limit
        too_many = opts.table_max_rows and len(group) >= opts.table_max_rows
        if too_big or too_many:
            flush(not units)
            group, gpages, size = [], [], fixed
        group.append(line)
        gpages.append(rp)
        size += len(line) + 1
    if group or not units:
        flush(not units)
    return units


def _pages_for_span(e, start, end):
    """根据段落内的页码分界（跨页合并时记录），计算文本片段 [start, end) 所在页。"""
    marks = e.get("page_marks")
    if not marks:
        return e["pages"]
    first = last = marks[0][1]
    for off, page in marks:
        if off <= start:
            first = page
        if off < end:
            last = page
    return [first, last]


def _glued_size(units) -> int:
    """末尾与下一单元绑定的单元（标题、引导语）的总长度，它们会随下一单元进入同一块。"""
    n = 0
    for u in reversed(units):
        if not u.glue:
            break
        n += len(u.md) + 2
    return n


def _split_with_first(text: str, first_limit: int, limit: int) -> list[str]:
    """切分长段落；首片额外给前面绑定的标题/引导语留出空间。"""
    if len(text) <= first_limit or first_limit >= limit:
        return hard_split(text, limit)
    head = hard_split(text, max(first_limit, 40))[0]
    rest = text[text.find(head) + len(head):].strip()
    return [head] + (hard_split(rest, limit) if rest else [])


def _section_units(sec, budget, opts) -> list[Unit]:
    units: list[Unit] = []
    if sec["heading"]:
        h = sec["heading"]
        units.append(Unit("#" * h["level"] + " " + h["text"], h["pages"], glue=True, kind="heading"))
    els = sec["elements"]
    i = 0
    while i < len(els):
        e = els[i]
        t = e["type"]
        nxt = els[i + 1] if i + 1 < len(els) else None
        if t == "paragraph":
            text = e["text"]
            is_caption = e.get("role") == "caption" or (
                CAPTION_RE.match(text) and len(text) <= 50 and not text.endswith(("。", "."))
            )
            if is_caption and nxt and nxt["type"] == "table":
                units.extend(_table_units(nxt, text, budget, opts, budget - _glued_size(units)))
                i += 2
                continue
            pieces = _split_with_first(text, budget - _glued_size(units), budget)
            cursor = 0
            for k, p in enumerate(pieces):
                last = k == len(pieces) - 1
                # 引导语（以冒号结尾，或紧挨表格/列表的短句）与后续内容绑定
                lead_in = nxt is not None and nxt["type"] in ("table", "list") and len(text) <= 120
                glue = last and (text.rstrip().endswith(("：", ":")) or lead_in)
                start = text.find(p, cursor)
                start = cursor if start < 0 else start
                cursor = start + len(p)
                pages = _pages_for_span(e, start, cursor) if len(pieces) > 1 else e["pages"]
                units.append(Unit(_md_paragraph(p), pages, glue=glue))
        elif t == "list":
            # 首段要给前面绑定的引导语留出空间
            group, size, limit = [], 0, budget - _glued_size(units)
            for line in _md_list_lines(e["items"]):
                for piece in hard_split(line, budget):
                    if group and size + len(piece) + 1 > limit:
                        units.append(Unit("\n".join(group), e["pages"], kind="list"))
                        group, size, limit = [], 0, budget
                    group.append(piece)
                    size += len(piece) + 1
            if group:
                units.append(Unit("\n".join(group), e["pages"], kind="list"))
        elif t == "table":
            units.extend(_table_units(e, "", budget, opts, budget - _glued_size(units)))
        elif t == "code":
            for piece in hard_split(e["text"], max(budget - 10, 50)) if len(e["text"]) > budget else [e["text"]]:
                # 正文含反引号时用更长围栏，避免把代码内容误作结束标记。
                longest = max((len(m.group()) for m in re.finditer(r"`+", piece)), default=0)
                fence = "`" * max(3, longest + 1)
                units.append(Unit(f"{fence}{e.get('language', '')}\n{piece}\n{fence}", e["pages"], kind="code"))
        elif t == "formula":
            text = e["text"].strip()
            for opening, closing in (("$$", "$$"), (r"\[", r"\]")):
                if text.startswith(opening) and text.endswith(closing):
                    text = text[len(opening):-len(closing)].strip()
                    break
            # 公式作为整体分块；超长公式由现有超限警告说明，不切断 LaTeX。
            units.append(Unit(f"$$\n{text}\n$$", e["pages"], kind="formula"))
        i += 1
    return units


# ---------------------------------------------------------------- 分块


class Fragment:
    def __init__(self, path, has_heading, units):
        self.path, self.has_heading, self.units = path, has_heading, units

    @property
    def ctx(self):
        return self.path[:-1] if self.has_heading else self.path


class Chunk:
    def __init__(self, fragments):
        self.fragments = fragments

    @property
    def ctx(self):
        ctxs = [f.ctx for f in self.fragments]
        out = []
        for items in zip(*ctxs):
            if all(x == items[0] for x in items):
                out.append(items[0])
            else:
                break
        return out

    @property
    def units(self):
        return [u for f in self.fragments for u in f.units]

    @property
    def pages(self):
        ps = [p for u in self.units for p in u.pages]
        return [min(ps), max(ps)] if ps else None

    def heading_only(self):
        return all(u.kind == "heading" for u in self.units)


def _context_lines(ctx, pages, opts) -> list[str]:
    page_txt = f"页码：{_fmt_pages(pages)}" if opts.include_pages and pages else ""
    if opts.context == "breadcrumb":
        parts = []
        names = [t for i, (_, t) in enumerate(ctx) if i == 0 or t != ctx[i - 1][1]]
        if names:
            parts.append("章节：" + " > ".join(names))
        if page_txt:
            parts.append(page_txt)
        return ["> " + " ｜ ".join(parts)] if parts else []
    lines = []
    if opts.context == "headings":
        lines += ["#" * lvl + " " + t for lvl, t in ctx]
    if page_txt:
        lines.append("> " + page_txt)
    return lines


def render_chunk(chunk: Chunk, opts) -> str:
    lines = _context_lines(chunk.ctx, chunk.pages, opts)
    body = "\n\n".join(u.md for u in chunk.units)
    return "\n\n".join(lines + [body]) if body else "\n\n".join(lines)


def _starts_with(a, prefix):
    return len(a) >= len(prefix) and a[: len(prefix)] == prefix


def _merge_small(chunks, opts, min_shared):
    """过短的块与相邻块合并：只并入子章节或同一父章节下的兄弟章节，不跨越顶层章节，不破坏表格续块。"""

    def size(c):
        return len(render_chunk(c, opts))

    def joinable(outer, inner):
        # inner 位于 outer 的范围内：子章节，或共享足够深的父章节的兄弟章节
        return _starts_with(inner, outer) and (len(inner) > len(outer) or len(outer) >= min_shared)

    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(chunks):
            c = chunks[i]
            if size(c) >= opts.min_chars and not c.heading_only():
                i += 1
                continue
            nxt = chunks[i + 1] if i + 1 < len(chunks) else None
            if nxt is not None and not nxt.units[0].brk and joinable(c.ctx, nxt.ctx):
                merged = Chunk(c.fragments + nxt.fragments)
                if size(merged) <= opts.max_chars or (c.heading_only() and size(merged) <= opts.max_chars + size(c)):
                    chunks[i : i + 2] = [merged]
                    changed = True
                    continue
            if i > 0 and not c.heading_only() and not c.units[0].brk and joinable(chunks[i - 1].ctx, c.ctx):
                merged = Chunk(chunks[i - 1].fragments + c.fragments)
                if size(merged) <= opts.max_chars:
                    chunks[i - 1 : i + 1] = [merged]
                    changed = True
                    continue
            i += 1
    return chunks


def build_chunks(elements, opts: ChunkOptions) -> list[Chunk]:
    chunks: list[Chunk] = []
    for sec in _sections(elements):
        path = sec["path"]
        overhead = len("\n\n".join(_context_lines(path, [9999, 9999], opts))) + 4
        budget = max(80, opts.max_chars - overhead)
        units = _section_units(sec, budget, opts)
        if not units:
            continue
        groups: list[list[Unit]] = []
        cur: list[Unit] = []
        size = 0
        for u in units:
            if cur and (u.brk or size + len(u.md) + 2 > budget):
                carry = []
                while len(cur) > 1 and cur[-1].glue:
                    carry.insert(0, cur.pop())
                groups.append(cur)
                cur = carry
                size = sum(len(x.md) + 2 for x in cur)
            cur.append(u)
            size += len(u.md) + 2
        if cur:
            groups.append(cur)
        for k, g in enumerate(groups):
            has_heading = k == 0 and sec["heading"] is not None
            chunks.append(Chunk([Fragment(path, has_heading, g)]))
    # 文档只有一个最高级标题且位于开头时视为文档标题，其下一级才是“顶层章节”
    heads = [e for e in elements if e["type"] == "heading"]
    top = min((h["level"] for h in heads), default=1)
    has_title = bool(heads) and heads[0]["level"] == top and sum(h["level"] == top for h in heads) == 1
    return _merge_small(chunks, opts, min_shared=2 if has_title else 1)


def to_markdown(elements, opts: ChunkOptions) -> dict:
    chunks = build_chunks(elements, opts)
    texts = [render_chunk(c, opts) for c in chunks]
    sep = opts.separator
    joiner = f"\n\n{sep}\n\n"
    markdown = joiner.join(texts) + "\n"
    warnings = []
    clash = sum(t.count(sep) for t in texts)
    if clash:
        warnings.append(f"原文中出现了 {clash} 处与分隔符相同的文本，导入时会被误切分，建议更换分隔符。")
    over = [i + 1 for i, t in enumerate(texts) if len(t) > opts.max_chars]
    if over:
        warnings.append(f"{len(over)} 个块超过最大字数（单行/单条内容无法再拆），序号：{', '.join(map(str, over[:20]))}")
    lens = [len(t) for t in texts]
    return {
        "markdown": markdown,
        "chunks": [
            {"index": i + 1, "chars": len(t), "pages": c.pages, "path": [x for _, x in c.ctx]}
            for i, (c, t) in enumerate(zip(chunks, texts))
        ],
        "stats": {
            "chunks": len(texts),
            "avg_chars": round(sum(lens) / len(lens)) if lens else 0,
            "max_chars": max(lens, default=0),
            "min_chars": min(lens, default=0),
        },
        "warnings": warnings,
    }
