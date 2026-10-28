"""把单个 HTML 表格展开为二维网格，合并格的内容填入覆盖的每一格。"""
from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser


@dataclass
class HTMLTable:
    rows: list[list[str]]
    header_rows: int
    has_images: bool


@dataclass
class _Cell:
    text: str
    rowspan: int
    colspan: int
    header: bool


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[list[_Cell]] = []
        self.row = None
        self.cell: list[str] | None = None
        self.spans = (1, 1)
        self.in_table = False
        self.table_count = 0
        self.row_groups: list[int] = []
        self.group = 0
        self.in_header_group = False
        self.header_rows: list[bool] = []
        self.cell_header = False
        self.has_images = False

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            if self.in_table or self.table_count:
                raise ValueError("OXR 表格包含嵌套表格或多个表格，无法转换")
            self.in_table = True
            self.table_count += 1
        elif self.in_table:
            if tag in ("thead", "tbody", "tfoot"):
                self.group += 1
                self.in_header_group = tag == "thead"
            elif tag == "tr":
                if self.row is not None:
                    raise ValueError("OXR HTML 表格缺少行结束标记")
                self.row = []
            elif tag in ("td", "th"):
                if self.row is None or self.cell is not None:
                    raise ValueError("OXR HTML 表格单元格结构无效")
                values = dict(attrs)
                try:
                    rowspan = int(values.get("rowspan", "1"))
                    colspan = int(values.get("colspan", "1"))
                except (TypeError, ValueError) as exc:
                    raise ValueError("OXR HTML 表格的合并格跨度无效") from exc
                if rowspan < 0 or colspan < 1:
                    raise ValueError("OXR HTML 表格的合并格跨度无效")
                self.spans = rowspan, colspan
                self.cell_header = tag == "th"
                self.cell = []
            elif self.cell is not None and tag in ("br", "p", "div"):
                self.cell.append("\n")
            elif self.cell is not None and tag in ("sup", "sub"):
                self.cell.append("^{" if tag == "sup" else "_{")
            elif self.cell is not None and tag == "img":
                self.has_images = True
                alt = (dict(attrs).get("alt") or "").strip()
                self.cell.append(f"[图片未导出：{alt}]" if alt else "[图片未导出]")

    def handle_endtag(self, tag):
        if not self.in_table:
            return
        if tag in ("td", "th"):
            if self.cell is None:
                raise ValueError("OXR HTML 表格单元格结构无效")
            self.row.append(_Cell("".join(self.cell).strip(), *self.spans, self.cell_header))
            self.cell = None
        elif tag == "tr":
            if self.row is None or self.cell is not None:
                raise ValueError("OXR HTML 表格行结构无效")
            self.rows.append(self.row)
            self.row_groups.append(self.group)
            self.header_rows.append(
                self.in_header_group or (bool(self.row) and all(c.header for c in self.row))
            )
            self.row = None
        elif tag in ("thead", "tbody", "tfoot"):
            self.group += 1
            self.in_header_group = False
        elif tag == "table":
            if self.row is not None:
                raise ValueError("OXR HTML 表格缺少行结束标记")
            self.in_table = False
        elif self.cell is not None and tag in ("p", "div"):
            self.cell.append("\n")
        elif self.cell is not None and tag in ("sup", "sub"):
            self.cell.append("}")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse_html_table(html: str) -> HTMLTable:
    parser = _TableParser()
    parser.feed(html)
    parser.close()
    if parser.table_count != 1 or parser.in_table or not parser.rows:
        raise ValueError("OXR 未返回完整的 HTML 表格")
    cells: dict[tuple[int, int], str] = {}
    # 记录每个网格位置的原始单元格，区分真正的合并格和同名独立单元格。
    origins: dict[tuple[int, int], tuple[int, int]] = {}
    group_ends = {group: ri + 1 for ri, group in enumerate(parser.row_groups)}
    for ri, row in enumerate(parser.rows):
        ci = 0
        for cell in row:
            while (ri, ci) in cells:
                ci += 1
            # rowspan=0 延续到当前行组（thead/tbody/tfoot）的末行。
            rowspan = cell.rowspan or group_ends[parser.row_groups[ri]] - ri
            if ri + rowspan > len(parser.rows):
                raise ValueError("OXR HTML 表格的合并格超出行数")
            for rr in range(ri, ri + rowspan):
                for cc in range(ci, ci + cell.colspan):
                    if (rr, cc) in cells:
                        raise ValueError("OXR HTML 表格的合并格相互重叠")
                    cells[rr, cc] = cell.text
                    origins[rr, cc] = (ri, ci)
            ci += cell.colspan
    if not cells:
        raise ValueError("OXR HTML 表格没有单元格")
    width = max(ci for _, ci in cells) + 1
    rows = [[cells.get((ri, ci), "") for ci in range(width)] for ri in range(len(parser.rows))]
    header_rows = 0
    for marked_header in parser.header_rows:
        if not marked_header:
            break
        header_rows += 1
    if not header_rows:
        # OXR 常只输出 td。用首行跨行跨度及横向合并格的拆分识别子表头，
        # 不根据文字相同或“是否数字”猜测表头，避免吞掉首行数据。
        header_rows = 1
        for ri in range(1, len(rows)):
            if parser.row_groups[ri] != parser.row_groups[ri - 1]:
                break
            first_row_continues = any(origins.get((ri, ci), (-1, -1))[0] == 0 for ci in range(width))
            split_group = any(
                origins.get((ri - 1, ci)) == origins.get((ri - 1, ci + 1))
                and origins.get((ri - 1, ci)) is not None
                and origins.get((ri, ci)) is not None and origins.get((ri, ci + 1)) is not None
                and origins[ri, ci] != origins[ri, ci + 1]
                for ci in range(width - 1)
            )
            if not first_row_continues and not split_group:
                break
            header_rows += 1
    return HTMLTable(rows, header_rows, parser.has_images)
