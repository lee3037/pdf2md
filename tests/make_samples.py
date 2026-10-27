"""生成测试用 PDF：文本型（含页眉页脚、多级标题、列表、跨页表格、双栏）与扫描型。"""
import sys
from pathlib import Path

import pymupdf

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "samples")
OUT.mkdir(parents=True, exist_ok=True)
CSS = """
* {font-size: 10.5pt; line-height: 1.5;}
h1 {font-size: 20pt; font-weight: bold; margin: 12pt 0 8pt 0;}
h2 {font-size: 15pt; font-weight: bold; margin: 10pt 0 6pt 0;}
h3 {font-size: 12pt; font-weight: bold; margin: 8pt 0 4pt 0;}
p {margin: 0 0 6pt 0; text-indent: 21pt;}
table {border-collapse: collapse; width: 100%;}
td, th {border: 1px solid black; padding: 3pt; font-size: 9.5pt;}
th {font-weight: bold;}
"""

PARA = ("本制度适用于公司全体员工及外包人员。各部门应当按照统一部署，结合实际情况制定实施细则，"
        "明确责任分工，确保各项措施落实到位。对于执行过程中出现的问题，应及时向主管部门反馈，"
        "由主管部门会同相关部门研究处理，并将处理结果书面通知相关方。")


def body_html():
    rows = "".join(
        f"<tr><td>{i}</td><td>设备-{i:03d}</td><td>{'服务器' if i % 2 else '交换机'}</td>"
        f"<td>{(i * 37) % 900 + 100}</td><td>机房{(i % 3) + 1}号</td></tr>"
        for i in range(1, 61)
    )
    return f"""
<h1>信息安全管理制度</h1>
<h2>第一章 总则</h2>
<h3>1.1 目的</h3>
<p>为加强公司信息安全管理，保障信息系统安全稳定运行，依据国家有关法律法规，制定本制度。{PARA}</p>
<h3>1.2 适用范围</h3>
<p>{PARA}{PARA}</p>
<p>主要职责包括：</p>
<ul>
<li>制定信息安全策略和规划；</li>
<li>组织开展信息安全检查与评估工作，督促问题整改落实；</li>
<li>负责信息安全事件的应急处置。</li>
</ul>
<h2>第二章 资产管理</h2>
<h3>2.1 资产清单</h3>
<p>表 1 列出了公司主要的信息资产，包括设备编号、类型、数量和存放位置。</p>
<table>
<tr><th>序号</th><th>设备编号</th><th>类型</th><th>数量</th><th>存放位置</th></tr>
{rows}
</table>
<h3>2.2 资产处置</h3>
<p>资产报废前应当进行数据清除，并经信息安全部门确认。{PARA}{PARA}{PARA}</p>
<ol>
<li>提交报废申请；</li>
<li>信息安全部门进行数据清除；</li>
<li>资产管理部门办理报废手续。</li>
</ol>
<h2>第三章 附则</h2>
<p>本制度由信息安全部负责解释，自发布之日起施行。{PARA}</p>
"""


def make_text_pdf(path):
    story = pymupdf.Story(html=body_html(), user_css=CSS)
    writer = pymupdf.DocumentWriter(str(path))
    mediabox = pymupdf.paper_rect("a4")
    where = mediabox + (60, 70, -60, -70)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    add_header_footer(path)


def add_header_footer(path):
    doc = pymupdf.open(path)
    n = len(doc)
    for i, page in enumerate(doc):
        page.insert_text((60, 45), "XX科技有限公司 内部资料 严禁外传", fontname="china-s", fontsize=8)
        page.draw_line((60, 52), (page.rect.width - 60, 52), width=0.5)
        page.insert_text((page.rect.width / 2 - 20, page.rect.height - 35), f"第 {i + 1} 页 共 {n} 页",
                         fontname="china-s", fontsize=8)
    doc.saveIncr()


def make_two_column_pdf(path):
    doc = pymupdf.open()
    page = doc.new_page()
    w = page.rect.width
    page.insert_htmlbox(pymupdf.Rect(60, 60, w - 60, 110), "<h1>双栏排版测试</h1>", css=CSS)
    left = "<h2>左栏标题</h2>" + "".join(f"<p>左栏第{i}段。{PARA}</p>" for i in range(1, 4))
    right = "<h2>右栏标题</h2>" + "".join(f"<p>右栏第{i}段。{PARA}</p>" for i in range(1, 4))
    page.insert_htmlbox(pymupdf.Rect(60, 120, w / 2 - 10, 780), left, css=CSS)
    page.insert_htmlbox(pymupdf.Rect(w / 2 + 10, 120, w - 60, 780), right, css=CSS)
    doc.save(path)


COMPLEX_CSS = """
* {font-size: 10.5pt; line-height: 1.6;}
h1 {font-size: 18pt; font-weight: bold; text-align: center;}
h2, h3, h4 {font-size: 11pt; font-weight: bold; margin: 8pt 0 4pt 0;}
p {margin: 0 0 6pt 0; text-indent: 21pt;}
table {border-collapse: collapse; width: 100%;}
td, th {border: 1px solid black; padding: 3pt; font-size: 9.5pt; text-align: center;}
"""


def complex_html():
    long_para = "".join(f"第{i}句说明了年度预算编制的原则和具体要求，各单位必须严格执行" + ("。" if i % 3 == 0 else "，") for i in range(1, 60))
    return f"""
<h1>2025年度预算管理办法</h1>
<h2>一、总体要求</h2>
<p>为规范预算管理，提高资金使用效益，制定本办法。</p>
<h3>（一）编制原则</h3>
<p>{long_para}</p>
<h4>1. 收支平衡</h4>
<p>坚持量入为出、收支平衡的原则，不得编制赤字预算。</p>
<h4>2. 统筹兼顾</h4>
<p>兼顾当前与长远，统筹安排各项支出。</p>
<h3>（二）预算明细</h3>
<p>各部门预算如下表所示。</p>
<table>
<tr><th rowspan="2">部门</th><th rowspan="2">项目</th><th colspan="2">2024年</th><th colspan="2">2025年</th></tr>
<tr><th>预算</th><th>决算</th><th>预算</th><th>增幅</th></tr>
<tr><td rowspan="2">研发部</td><td>人员经费</td><td>500</td><td>480</td><td>560</td><td>12%</td></tr>
<tr><td>设备购置</td><td>300</td><td>310</td><td>280</td><td>-7%</td></tr>
<tr><td rowspan="2">市场部</td><td>推广费用</td><td>200</td><td>220</td><td>260</td><td>30%</td></tr>
<tr><td>差旅费用</td><td>80</td><td>75</td><td>90</td><td>13%</td></tr>
</table>
<h2>二、执行与监督</h2>
<p>预算一经批准，各部门应严格执行，不得擅自调整。确需调整的，应当按程序报批。</p>
"""


def make_complex_pdf(path):
    story = pymupdf.Story(html=complex_html(), user_css=COMPLEX_CSS)
    writer = pymupdf.DocumentWriter(str(path))
    mediabox = pymupdf.paper_rect("a5")
    where = mediabox + (40, 50, -40, -50)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    doc = pymupdf.open(path)
    for i, page in enumerate(doc):
        page.insert_text((page.rect.width / 2 - 5, page.rect.height - 25), f"- {i + 1} -", fontsize=8)
    doc.set_toc([[1, "2025年度预算管理办法", 1], [2, "一、总体要求", 1], [3, "（一）编制原则", 1],
                 [3, "（二）预算明细", 2], [2, "二、执行与监督", 2]])
    doc.saveIncr()


def make_scanned_pdf(src, path, dpi=150):
    srcdoc = pymupdf.open(src)
    out = pymupdf.open()
    for page in srcdoc:
        pix = page.get_pixmap(dpi=dpi, colorspace="gray")
        p = out.new_page(width=page.rect.width, height=page.rect.height)
        p.insert_image(p.rect, stream=pix.tobytes("png"))
    out.save(path, deflate=True)


if __name__ == "__main__":
    make_text_pdf(OUT / "text_cn.pdf")
    make_two_column_pdf(OUT / "two_column.pdf")
    make_scanned_pdf(OUT / "text_cn.pdf", OUT / "scanned_cn.pdf")
    make_complex_pdf(OUT / "complex_cn.pdf")
    for f in sorted(OUT.glob("*.pdf")):
        print(f, len(pymupdf.open(f)), "pages")
