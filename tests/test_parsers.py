"""后端边界测试：真实 multipart、响应语义和共享结构整理，不访问外网。"""
import copy
import json
import sys
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

import httpx
import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import parsers  # noqa: E402
from app.chunker import ChunkOptions, to_markdown  # noqa: E402
from app.parsers.html_table import parse_html_table  # noqa: E402
from app.parsers.oxr import OXRParseError, OXRParser, adapt_output  # noqa: E402
from app.pipeline import ConvertOptions, convert  # noqa: E402


@pytest.fixture
def pdf(tmp_path):
    path = tmp_path / "document.pdf"
    with pymupdf.open() as doc:
        doc.new_page().insert_text((30, 50), "Document")
        doc.new_page().insert_text((30, 50), "Second page")
        doc.save(path)
    return path


def block(kind, content, fmt="text", y=250):
    return {"idx": 0, "type": kind, "content": content, "format": fmt, "bbox": [50, y, 900, y + 40]}


def output(*page_blocks):
    return {"pages": [{"page_num": i, "page_size": {"w": 1240, "h": 1755},
                       "merge_content_from_pre_page": False, "blocks": blocks}
                      for i, blocks in enumerate(page_blocks)]}


def response(document, warnings=None):
    return {"code": 0, "message": "任务成功", "warnings": warnings or [],
            "data": {"task_id": "test-task", "error": None,
                     "result": {"file_name": "document.pdf", "outputs": {"json": document}}, "metadata": {}}}


def install_backend(monkeypatch, handler):
    backend = OXRParser(transport=httpx.MockTransport(handler))
    monkeypatch.setitem(parsers._registry, "oxr", backend)
    return backend


def test_options_compatibility_and_registry():
    assert ConvertOptions().parser == "pymupdf"
    assert ConvertOptions.from_dict({"ocr_mode": "off", "ocr_dpi": 900}).ocr_dpi == 300
    oxr = ConvertOptions.from_dict({"parser": "oxr", "ocr_mode": "invalid", "ocr_dpi": "not-a-number"})
    assert oxr.parser == "oxr" and oxr.ocr_mode == "auto" and oxr.ocr_dpi == 200
    assert parsers.catalog() == [
        {"id": "pymupdf", "name": "PyMuPDF + RapidOCR", "local_ocr_options": True},
        {"id": "oxr", "name": "OXR", "local_ocr_options": False},
    ]
    for parser in ("unknown", ""):
        with pytest.raises(ValueError, match="未知解析后端"):
            ConvertOptions.from_dict({"parser": parser})
        with pytest.raises(ValueError, match="未知解析后端"):
            convert("unused.pdf", ConvertOptions(parser=parser), ChunkOptions())


def test_oxr_http_contract_and_reading_order(pdf, monkeypatch):
    monkeypatch.setenv("STRATUM_OXR_BASE_URL", "https://self-hosted.example/v1/")
    monkeypatch.setenv("STRATUM_OXR_API_KEY", "test-key")
    monkeypatch.setenv("STRATUM_OXR_TIMEOUT", "72")
    document = output([
        block("Title", "文档标题"), block("Title", "1 总则"), block("Title", "1.1 范围"),
        block("Text", "右侧块先读。", y=800), block("Text", "左侧块后读。", y=300),
        block("Page-footer", "1", y=1700), block("Picture", "", fmt="markdown"),
    ], [block("Text", "- 第一项\n- 第二项"), block("Code Block", "```python\nprint('ok')\n```", "markdown")])

    def handle(request):
        assert request.method == "POST" and str(request.url) == "https://self-hosted.example/v1/parse/sync"
        assert request.extensions["timeout"]["read"] == 72
        multipart = BytesParser(policy=default).parsebytes(
            b"Content-Type: " + request.headers["content-type"].encode() + b"\r\n\r\n" + request.read())
        fields = {part.get_param("name", header="content-disposition"): part for part in multipart.iter_parts()}
        assert fields["file"].get_content_type() == "application/pdf"
        assert fields["file"].get_payload(decode=True) == pdf.read_bytes()
        assert fields["api_key"].get_content() == "test-key"
        assert fields["output_formats"].get_content() == "json"
        assert json.loads(fields["feature_config"].get_content()) == {"keep_header_footer": True}
        assert json.loads(fields["element_formats"].get_content()) == {"table": "html", "image": "none", "formula": "latex"}
        assert "ocr_dpi" not in fields and "ocr_mode" not in fields
        return httpx.Response(200, json=response(document, ["服务识别警告"]))

    install_backend(monkeypatch, handle)
    progress = []
    converted = convert(str(pdf), ConvertOptions(parser="oxr", ocr_mode="off", ocr_dpi=100),
                        ChunkOptions(), progress=lambda done, total: progress.append((done, total)))
    elements, result = converted["elements"], converted["result"]
    assert progress == [(0, 2), (2, 2)]
    assert [e["level"] for e in elements if e["type"] == "heading"] == [1, 2, 3]
    assert result["markdown"].index("右侧块先读") < result["markdown"].index("左侧块后读")
    assert "```python\nprint('ok')\n```" in result["markdown"]
    assert result["markdown"].count("```") == 2
    assert "- 第一项\n- 第二项" in result["markdown"]
    assert result["doc_stats"]["removed_header_footer"] == 1
    assert elements[-1]["pages"] == [2, 2]
    assert all("size" not in element and "bbox" not in element for element in elements)
    assert "OXR：服务识别警告" in converted["source_warnings"]
    assert any("图片内容未导出" in w for w in result["warnings"])


def test_html_spans_table_continuation_and_kv():
    html = ("<table><tr><th rowspan='2'>部门</th><th colspan='2'>2024年</th></tr>"
            "<tr><th>预算</th><th>决算</th></tr>"
            "<tr><td rowspan='2'>研发部</td><td>1 2</td><td>A &amp; B</td></tr>"
            "<tr><td>13</td><td>14</td></tr></table>")
    assert parse_html_table(html).rows == [
        ["部门", "2024年", "2024年"], ["部门", "预算", "决算"],
        ["研发部", "1 2", "A & B"], ["研发部", "13", "14"],
    ]
    tail = "<table><tr><td>部门</td><td>2024年 / 预算</td><td>2024年 / 决算</td></tr><tr><td>运营部</td><td>15</td><td>16</td></tr></table>"
    parsed = adapt_output(output([block("Table", html, "html")], [
        block("Caption", "续表"), block("Table", tail, "html")]), {"page_count": 2, "toc": []}, True)
    table = parsed.elements[0]
    assert table["header"] == ["部门", "2024年 / 预算", "2024年 / 决算"]
    assert table["pages"] == [1, 2] and table["row_pages"] == [1, 1, 2]
    assert len(table["rows"]) == 3 and parsed.stats["tables_merged"] == 1
    result = to_markdown(parsed.elements, ChunkOptions(table_mode="kv", table_max_rows=1))
    assert "部门：研发部；2024年 / 预算：1 2" in result["markdown"]
    assert [chunk["pages"] for chunk in result["chunks"]] == [[1, 1], [1, 1], [2, 2]]


def test_semantic_headers_bookmarks_paragraphs_and_atomic_formula():
    long_formula = r"\frac{a_1+b_2}{c_3}" * 40
    document = output([
        block("Page-header", "内部资料", y=20), block("Title", "章一"),
        block("Text", "本段文字在前一页末尾开始并且继续到"),
    ], [
        block("Page-header", "内部资料", y=20), block("Text", "下一页结束。"),
        block("Title", "章二"), block("Title", "小节"), block("Formula", long_formula, "latex"),
    ])
    info = {"page_count": 2, "toc": [[1, "章一", 1], [1, "章二", 2], [2, "小节", 2]]}
    parsed = adapt_output(document, info, True)
    assert [e["level"] for e in parsed.elements if e["type"] == "heading"] == [1, 1, 2]
    para = next(e for e in parsed.elements if e["type"] == "paragraph")
    assert para["text"] == "本段文字在前一页末尾开始并且继续到下一页结束。"
    assert para["pages"] == [1, 2] and len(para["page_marks"]) == 2
    md = to_markdown(parsed.elements, ChunkOptions(max_chars=100))
    assert "$$\n" + long_formula + "\n$$" in md["markdown"]
    assert any("超过最大字数" in w for w in md["warnings"])
    kept = adapt_output(document, info, False)
    assert kept.stats["removed_header_footer"] == 0
    assert sum(e.get("text") == "内部资料" for e in kept.elements) == 2


@pytest.mark.parametrize("status,payload,expected", [
    (200, {"code": 1137, "message": "模型不可用"}, "code 1137.*模型不可用"),
    (413, {"code": 1133, "message": "file too large"}, "10 MB.*20 页"),
    (400, {"code": 1133, "message": "file exceeds limit"}, "20 页.*10 MB"),
    (504, {}, "排队或解析超时"),
    (429, {}, "请求过多"),
    (502, {}, "HTTP 502"),
    (200, {"message": "missing code"}, "业务状态码"),
    (200, {"code": 0, "data": None}, "data 无效"),
    (200, {"code": 0, "data": {"error": "识别失败"}}, "识别失败"),
    (200, {"code": 0, "data": {"result": {"outputs": {"markdown": "only md"}}}}, "JSON pages"),
])
def test_service_errors_never_fall_back(pdf, monkeypatch, status, payload, expected):
    monkeypatch.delenv("STRATUM_OXR_BASE_URL", raising=False)
    backend = OXRParser(transport=httpx.MockTransport(lambda _: httpx.Response(status, json=payload)))
    with pytest.raises(OXRParseError, match=expected):
        backend.parse(str(pdf), ConvertOptions(parser="oxr"))


@pytest.mark.parametrize("error,expected", [(httpx.ReadTimeout, "请求超时"), (httpx.ConnectError, "无法连接")])
def test_network_errors(pdf, error, expected):
    def handle(request):
        raise error("internal connection details", request=request)
    backend = OXRParser(transport=httpx.MockTransport(handle))
    with pytest.raises(OXRParseError, match=expected) as exc:
        backend.parse(str(pdf), ConvertOptions(parser="oxr"))
    assert "internal connection details" not in str(exc.value)


def test_limits_do_not_apply_to_self_hosted(pdf, monkeypatch):
    monkeypatch.setenv("STRATUM_OXR_BASE_URL", "http://localhost:8000/v1")
    backend = OXRParser(transport=httpx.MockTransport(
        lambda _: httpx.Response(413, json={"code": 1133, "message": "file too large"})))
    with pytest.raises(OXRParseError) as exc:
        backend.parse(str(pdf), ConvertOptions(parser="oxr"))
    assert "10 MB" not in str(exc.value) and "20 页" not in str(exc.value)


@pytest.mark.parametrize("document,expected", [
    ({"pages": []}, "页数"),
    (output([], []), "未返回可用"),
    (output([block("Unknown", "text")], []), "暂不支持"),
    (output([block("Table", "| A | B |", "markdown")], []), "HTML 表格"),
    (output([block("Table", "<table><tr><td>missing end", "html")], []), "完整的 HTML 表格"),
    (output([block("Table", "<table><tr><td></td></tr></table>", "html")], []), "空的 HTML 表格"),
    (output([block("Formula", "<math>x</math>", "mathml")], []), "LaTeX"),
])
def test_invalid_or_unsupported_output(document, expected):
    with pytest.raises(ValueError, match=expected):
        adapt_output(document, {"page_count": 2}, True)


def test_explicit_grid_does_not_delete_identical_columns():
    html = "<table><tr><td colspan='2'>相同</td></tr><tr><td colspan='2'>同值</td></tr></table>"
    parsed = adapt_output(output([block("Table", html, "html")]), {"page_count": 1}, True)
    assert parsed.elements[0]["header"] == ["相同", "相同"]
    assert parsed.elements[0]["rows"] == [["同值", "同值"]]


@pytest.mark.parametrize("tag,grouped", [("th", True), ("th", False), ("td", False)])
def test_numeric_subheaders_preserve_years_in_kv(tag, grouped):
    head = (f'<tr><{tag} rowspan="2">指标</{tag}><{tag} colspan="2">年度</{tag}></tr>'
            f'<tr><{tag}>2023</{tag}><{tag}>2024</{tag}></tr>')
    body = '<tr><td>收入</td><td>100</td><td>200</td></tr>'
    html = '<table>' + (f'<thead>{head}</thead><tbody>{body}</tbody>' if grouped else head + body) + '</table>'
    parsed = adapt_output(output([block("Table", html, "html")]), {"page_count": 1}, False)
    assert parsed.elements[0]["header"] == ["指标", "年度 / 2023", "年度 / 2024"]
    assert parsed.elements[0]["rows"] == [["收入", "100", "200"]]
    md = to_markdown(parsed.elements, ChunkOptions(table_mode="kv"))["markdown"]
    assert "年度 / 2023：100；年度 / 2024：200" in md


@pytest.mark.parametrize("tag", ["th", "td"])
def test_same_named_headers_do_not_consume_first_data_row(tag):
    html = (f'<table><tr><{tag}>预算</{tag}><{tag}>预算</{tag}></tr>'
            '<tr><td>100万元</td><td>200万元</td></tr>'
            '<tr><td>300万元</td><td>400万元</td></tr></table>')
    parsed = adapt_output(output([block("Table", html, "html")]), {"page_count": 1}, False)
    assert parsed.elements[0]["header"] == ["预算", "预算"]
    assert parsed.elements[0]["rows"] == [["100万元", "200万元"], ["300万元", "400万元"]]


def test_table_scripts_and_images_keep_meaning_and_page_warning():
    html = ('<table><tr><td>参数</td><td>数值</td><td>电路图</td></tr>'
            '<tr><td>容量</td><td>10<sup>3</sup> / H<sub>2</sub>O</td>'
            '<td><img src="image.png" alt="示意图"></td></tr></table>')
    parsed = adapt_output(output([block("Text", "说明。")], [block("Table", html, "html")]),
                          {"page_count": 2}, False)
    for mode in ("markdown", "kv"):
        md = to_markdown(parsed.elements, ChunkOptions(table_mode=mode))["markdown"]
        assert "10^{3} / H_{2}O" in md
        assert "电路图" in md and "[图片未导出：示意图]" in md
    assert parsed.warnings == ["OXR 图片内容未导出，涉及页码：2。"]


def test_rowspan_zero_stops_at_row_group_and_titles_are_not_page_numbers():
    html = ("<table><thead><tr><th rowspan='0'>A</th><th>B</th></tr><tr><th>C</th></tr></thead>"
            "<tbody><tr><td>D</td><td>E</td></tr></tbody></table>")
    assert parse_html_table(html).rows == [["A", "B"], ["A", "C"], ["D", "E"]]
    parsed = adapt_output(output([block("Title", "1", y=20), block("Formula", "123", "latex", y=20)]),
                          {"page_count": 1}, True)
    assert [e["text"] for e in parsed.elements] == ["1", "123"]
    assert parsed.stats["removed_header_footer"] == 0


def test_bad_page_and_content_are_rejected():
    valid = output([block("Text", "正文。")])
    for field, value in (("page_num", 9), ("page_size", None), ("blocks", None)):
        bad = copy.deepcopy(valid)
        bad["pages"][0][field] = value
        with pytest.raises(OXRParseError):
            adapt_output(bad, {"page_count": 1}, True)
    valid["pages"][0]["blocks"][0]["content"] = {"unexpected": "object"}
    with pytest.raises(OXRParseError, match="content"):
        adapt_output(valid, {"page_count": 1}, True)
