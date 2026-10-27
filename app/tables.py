"""表格清洗、跨页合并与 Markdown / 键值渲染。"""
from __future__ import annotations

from .textutil import clean_text, join_lines, strip_key


def _clean_cell(value, ocr: bool) -> str:
    if value is None:
        return ""
    parts = [clean_text(p, ocr) for p in str(value).split("\n")]
    return join_lines([p for p in parts if p])


def _drop_empty(rows: list[list[str]]) -> list[list[str]]:
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return rows
    keep = [j for j in range(len(rows[0])) if any(r[j] for r in rows)]
    return [[r[j] for j in keep] for r in rows]


def _merge_complementary_columns(rows: list[list[str]]) -> list[list[str]]:
    """相邻两列在每一行至多一个非空、且其中一列表头为空 → 视为被错误拆开的同一列。"""
    j = 0
    while rows and j < len(rows[0]) - 1:
        a = [r[j] for r in rows]
        b = [r[j + 1] for r in rows]
        complementary = all(not (x and y) for x, y in zip(a, b))
        if complementary and (not a[0] or not b[0]):
            for r in rows:
                r[j] = r[j] or r[j + 1]
                del r[j + 1]
        else:
            j += 1
    return rows


def _drop_duplicate_columns(rows: list[list[str]]) -> list[list[str]]:
    j = 0
    while rows and j < len(rows[0]) - 1:
        if all(r[j] == r[j + 1] for r in rows):
            for r in rows:
                del r[j + 1]
        else:
            j += 1
    return rows


def _merge_header_rows(rows: list[list[str]]) -> list[list[str]]:
    """两行表头（首行存在横向合并单元格）合并为一行：“上级 / 下级”。"""
    if len(rows) < 3:
        return rows
    h0, h1 = rows[0], rows[1]
    spanned = any(h0[j] and h0[j] == h0[j + 1] and h1[j] != h1[j + 1] for j in range(len(h0) - 1))
    if not spanned:
        return rows
    # 第二行必须像表头：不全是数字
    if sum(1 for c in h1 if c.replace(".", "").replace(",", "").isdigit()) > len(h1) / 2:
        return rows
    header = []
    for x, y in zip(h0, h1):
        if not y or x == y:
            header.append(x)
        elif not x:
            header.append(y)
        else:
            header.append(f"{x} / {y}")
    return [header] + rows[2:]


def normalize_table(raw_rows, ocr: bool = False) -> dict | None:
    """返回 {"header": [...], "rows": [[...]]}；无法构成表格时返回 None。"""
    if not raw_rows:
        return None
    width = max(len(r) for r in raw_rows)
    rows = [[_clean_cell(c, ocr) for c in r] + [""] * (width - len(r)) for r in raw_rows]
    rows = _drop_empty(rows)
    if not rows:
        return None
    rows = _merge_complementary_columns(rows)
    rows = _drop_duplicate_columns(rows)
    rows = _merge_header_rows(rows)
    if len(rows) < 2 or len(rows[0]) < 2:
        return None
    return {"header": rows[0], "rows": rows[1:]}


def table_as_text(raw_rows, ocr: bool = False) -> str:
    """退化表格（单行/单列）转为普通文本。"""
    lines = []
    for r in raw_rows or []:
        cells = [_clean_cell(c, ocr) for c in r]
        cells = [c for c in cells if c]
        if cells:
            lines.append(" ".join(cells))
    return "\n".join(lines)


def same_header(a: list[str], b: list[str]) -> bool:
    return len(a) == len(b) and all(strip_key(x) == strip_key(y) for x, y in zip(a, b))


def can_merge(t1: dict, t2: dict) -> bool:
    return len(t1["header"]) == len(t2["header"])


def merge_tables(t1: dict, t2: dict) -> dict:
    """把 t2 接到 t1 之后。t2 若重复了表头则去掉；t2 首行首列为空视为上一行跨页延续。

    row_pages 记录每一数据行的来源页码，用于分块后标注页码。
    """
    rows2 = [t2["header"]] + t2["rows"]
    pages2 = [t2["row_pages"][0] if t2.get("row_pages") else None] + list(t2.get("row_pages") or [None] * len(t2["rows"]))
    if same_header(t1["header"], rows2[0]):
        rows2, pages2 = rows2[1:], pages2[1:]
    rows = list(t1["rows"])
    pages = list(t1.get("row_pages") or [None] * len(rows))
    if rows and rows2 and not rows2[0][0] and any(rows2[0][1:]) and all(r[0] for r in rows):
        last, cont = rows[-1], rows2[0]
        rows[-1] = [join_lines([x, y]) if y and y != x else x for x, y in zip(last, cont)]
        rows2, pages2 = rows2[1:], pages2[1:]
    return {"header": t1["header"], "rows": rows + rows2, "row_pages": pages + pages2}


def _esc(cell: str) -> str:
    return cell.replace("|", "\\|").replace("\n", " ").strip()


def render_markdown(header: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(_esc(h) for h in header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for r in rows:
        lines.append("| " + " | ".join(_esc(c) for c in r) + " |")
    return "\n".join(lines)


def render_kv(header: list[str], rows: list[list[str]]) -> str:
    names = [h or f"列{i + 1}" for i, h in enumerate(header)]
    out = []
    for r in rows:
        pairs = [f"{n}：{v}" for n, v in zip(names, r) if v]
        if pairs:
            out.append("- " + "；".join(pairs))
    return "\n".join(out)


def render(header, rows, mode: str = "markdown") -> str:
    return render_kv(header, rows) if mode == "kv" else render_markdown(header, rows)
