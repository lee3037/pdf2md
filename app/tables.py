"""表格清洗、跨页合并与 Markdown / 键值渲染。"""
from __future__ import annotations

from .textutil import clean_text, join_lines, strip_key


def _clean_cell(value, ocr: bool) -> str:
    if value is None:
        return ""
    parts = [clean_text(p, ocr) for p in str(value).split("\n")]
    return join_lines([p for p in parts if p])


def _drop_empty(rows: list[list[str]], xs: list) -> tuple[list[list[str]], list]:
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return rows, xs
    keep = [j for j in range(len(rows[0])) if any(r[j] for r in rows)]
    return [[r[j] for j in keep] for r in rows], [xs[j] for j in keep]


def _merge_complementary_columns(rows, xs):
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
            del xs[j + 1]
        else:
            j += 1
    return rows, xs


def _drop_duplicate_columns(rows, xs):
    j = 0
    while rows and j < len(rows[0]) - 1:
        if all(r[j] == r[j + 1] for r in rows):
            for r in rows:
                del r[j + 1]
            del xs[j + 1]
        else:
            j += 1
    return rows, xs


def _merge_header_rows(rows: list[list[str]]) -> list[list[str]]:
    """多行表头（存在横向合并单元格）合并为一行：“上级 / 下级”，最多合并 3 行。"""
    for _ in range(2):
        merged = _merge_two_header_rows(rows)
        if merged is rows:
            break
        rows = merged
    return rows


def _merge_two_header_rows(rows: list[list[str]]) -> list[list[str]]:
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


def normalize_table(raw_rows, ocr: bool = False, col_x: list | None = None,
                    explicit_grid: bool = False, header_rows: int = 1) -> dict | None:
    """清洗表格；HTML 网格按明确的 header_rows 合并表头，不猜测数据列。"""
    if not raw_rows:
        return None
    width = max(len(r) for r in raw_rows)
    rows = [[_clean_cell(c, ocr) for c in r] + [""] * (width - len(r)) for r in raw_rows]
    xs = list(col_x) if col_x and len(col_x) == width else [None] * width
    if explicit_grid:
        header = []
        for ci in range(width):
            parts = []
            for row in rows[:header_rows]:
                if row[ci] and (not parts or row[ci] != parts[-1]):
                    parts.append(row[ci])
            header.append(" / ".join(parts))
        rows = [header] + [row for row in rows[header_rows:] if any(row)]
    else:
        rows, xs = _drop_empty(rows, xs)
    if not rows:
        return None
    if not explicit_grid:
        rows, xs = _merge_complementary_columns(rows, xs)
        rows, xs = _drop_duplicate_columns(rows, xs)
        rows = _merge_header_rows(rows)
    if len(rows) < 2 or len(rows[0]) < 2:
        return None
    return {"header": rows[0], "rows": rows[1:], "col_x": xs if all(x is not None for x in xs) else None}


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


def _column_map(t1: dict, t2: dict) -> list[int] | None:
    """t2 每列对应 t1 的哪一列。列数相同直接一一对应；否则按列左边界就近对齐（须单调且不重复）。"""
    n1, n2 = len(t1["header"]), len(t2["header"])
    if n1 == n2:
        return list(range(n1))
    x1, x2 = t1.get("col_x"), t2.get("col_x")
    if not x1 or not x2 or n2 > n1:
        return None
    mapping = []
    for x in x2:
        j = min(range(n1), key=lambda k: abs(x1[k] - x))
        if abs(x1[j] - x) > 12 or (mapping and j <= mapping[-1]):
            return None
        mapping.append(j)
    return mapping


def can_merge(t1: dict, t2: dict) -> bool:
    return _column_map(t1, t2) is not None


def merge_tables(t1: dict, t2: dict) -> dict:
    """把 t2（下一页的续表）接到 t1 之后。

    - 列数不同时按列位置对齐；
    - t2 若重复了表头则去掉；
    - t2 首行多数格为空：视为上一行跨页断开，拼回上一行；
    - t2 开头几行在“t1 中每行都有值”的列（如序号、类别等纵向合并列）为空：沿用上一行的值。

    row_pages 记录每一数据行的来源页码，用于分块后标注页码。
    """
    mapping = _column_map(t1, t2)
    n1 = len(t1["header"])

    def align(row):
        out = [""] * n1
        for v, j in zip(row, mapping):
            out[j] = v
        return out

    rows2 = [align(t2["header"])] + [align(r) for r in t2["rows"]]
    pages2 = [t2["row_pages"][0] if t2.get("row_pages") else None] + list(t2.get("row_pages") or [None] * len(t2["rows"]))
    if same_header(t1["header"], rows2[0]):
        rows2, pages2 = rows2[1:], pages2[1:]
    rows = list(t1["rows"])
    pages = list(t1.get("row_pages") or [None] * len(rows))
    if rows and rows2:
        first = rows2[0]
        empties = sum(1 for c in first if not c)
        if empties > n1 / 2 and any(first):
            rows[-1] = [join_lines([x, y]) if y and y != x else x for x, y in zip(rows[-1], first)]
            rows2, pages2 = rows2[1:], pages2[1:]
    if rows:
        # 只补最左侧连续为空的分类列；遇到首列有值的行（新分类或“合计”）即停止
        always = {j for j in range(n1) if all(r[j] for r in rows)}
        prev = rows[-1]
        for r in rows2:
            lead = next((j for j, c in enumerate(r) if c), n1)
            if lead == 0 or lead == n1 or not all(j in always for j in range(lead)):
                break
            for j in range(lead):
                r[j] = prev[j]
            prev = r
    return {"header": t1["header"], "rows": rows + rows2, "row_pages": pages + pages2, "col_x": t1.get("col_x")}


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
