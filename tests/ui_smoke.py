"""浏览器端冒烟测试（需另装 playwright）：python tests/ui_smoke.py [http://localhost:8000/] [截图目录]"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/pdf2md-ui")
OUT.mkdir(parents=True, exist_ok=True)
SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "complex_cn.pdf"

errors = []
checks = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE)
    page.screenshot(path=str(OUT / "1_landing.png"))

    # 拖入即转换
    page.set_input_files("input[type=file]", str(SAMPLE))
    page.wait_for_selector("article", timeout=180000)
    time.sleep(0.8)
    page.screenshot(path=str(OUT / "2_chunks.png"))
    n0 = page.locator("article").count()

    rail = page.locator("aside input")
    # 改最大字数 → 自动重新分块
    rail.nth(2).fill("400")
    time.sleep(2)
    checks["自动重新分块"] = page.locator("article").count() > n0

    # 编辑卡片
    page.hover("article >> nth=0")
    page.click("article >> nth=0 >> button[aria-label=编辑]")
    page.keyboard.press("Control+End")
    page.keyboard.type("手工补充的一句话。")
    page.keyboard.press("Control+Enter")
    time.sleep(0.4)
    checks["卡片编辑"] = "手工补充的一句话" in page.locator("article >> nth=0").inner_text()

    # 改分隔符 → 直接替换，保留编辑
    rail.nth(0).fill("@@@")
    time.sleep(0.8)
    page.click("text=Markdown")
    md = page.locator("textarea").input_value()
    checks["分隔符替换"] = "@@@" in md and "===CHUNK===" not in md and "手工补充的一句话" in md

    # 有编辑时改参数 → 需确认覆盖
    rail.nth(2).fill("600")
    time.sleep(0.8)
    checks["覆盖提示"] = page.locator("text=覆盖编辑并应用").count() == 1

    page.click("text=预览")
    time.sleep(0.4)
    page.screenshot(path=str(OUT / "3_preview.png"))

    with page.expect_download() as dl:
        page.click("text=下载 .md")
    dl.value.save_as(str(OUT / "out.md"))
    checks["下载"] = dl.value.suggested_filename == "complex_cn.md" and "@@@" in (OUT / "out.md").read_text()

    page.click("text=分块")
    page.click("article >> nth=1 >> header button >> nth=0")
    time.sleep(0.5)
    checks["页码跳转"] = "#page=" in (page.get_attribute("iframe", "src") or "")
    browser.close()

for k, v in checks.items():
    print(("✓" if v else "✗"), k)
print("页面错误:", errors or "无")
sys.exit(0 if all(checks.values()) and not errors else 1)
