"""浏览器端冒烟测试（需另装 playwright）：python tests/ui_smoke.py [http://localhost:8000/] [输出目录]"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/pdf2md-ui")
OUT.mkdir(parents=True, exist_ok=True)
SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "complex_cn.pdf"

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1500, "height": 950}, accept_downloads=True)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE)
    print("默认分隔符:", page.input_value("#separator"), "最大字数:", page.input_value("#max_chars"))

    page.set_input_files("#file", str(SAMPLE))
    page.click("#btn-convert")
    page.wait_for_selector(".chunk", timeout=180000)
    time.sleep(0.5)
    print("进度:", page.inner_text("#progress-text"))
    print("块数:", page.inner_text("#chunk-count"))
    print("统计:", page.inner_text("#stats").replace("\n", " "))
    page.screenshot(path=str(OUT / "1_chunks.png"))

    # 只改分隔符：编辑器内直接替换
    page.fill("#separator", "@@@@@@")
    page.click("#btn-rechunk")
    time.sleep(0.5)
    text = page.input_value("#editor")
    print("分隔符已替换:", "@@@@@@" in text and "===CHUNK===" not in text, "块数:", page.inner_text("#chunk-count"))

    # 手工编辑后分块视图实时更新
    page.evaluate("""() => { const e = document.querySelector('#editor');
        e.value += '\\n\\n@@@@@@\\n\\n手工新增的一块内容'; e.dispatchEvent(new Event('input')); }""")
    time.sleep(0.6)
    print("编辑后块数:", page.inner_text("#chunk-count"), page.inner_text("#edit-state"))

    # 修改其他参数 → 服务端重新分块（确认覆盖手工修改）
    page.once("dialog", lambda d: d.accept())
    page.select_option("#table_mode", "kv")
    page.fill("#max_chars", "600")
    page.click("#btn-rechunk")
    time.sleep(1)
    print("重新分块后块数:", page.inner_text("#chunk-count"), "键值表格:", "部门：研发部" in page.input_value("#editor"))

    page.click(".tab[data-tab=preview]")
    time.sleep(0.4)
    page.screenshot(path=str(OUT / "2_preview.png"))

    with page.expect_download() as dl:
        page.click("#btn-download")
    dl.value.save_as(str(OUT / "out.md"))
    print("下载文件:", dl.value.suggested_filename)

    page.click(".tab[data-tab=chunks]")
    page.click(".chunk .pages >> nth=1")
    time.sleep(1)
    print("PDF 跳转:", page.get_attribute("#pdf-frame", "src"))
    page.screenshot(path=str(OUT / "3_pdf.png"))
    browser.close()

print("页面错误:", errors or "无")
sys.exit(1 if errors else 0)
