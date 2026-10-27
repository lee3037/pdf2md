"""浏览器端冒烟测试（需另装 playwright）：python tests/ui_smoke.py [http://localhost:8000/] [截图目录]"""
import base64
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/pdf2md-ui")
OUT.mkdir(parents=True, exist_ok=True)
SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "complex_cn.pdf"

# 无头浏览器无法操作系统目录选择框：用浏览器私有文件系统（OPFS）里的目录代替，读写行为与真实目录一致
FAKE_PICKER = """
window.showDirectoryPicker = async () =>
  (await navigator.storage.getDirectory()).getDirectoryHandle('smoke', { create: true })
"""
SEED = """async ([name, b64]) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('smoke', { create: true })
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  await w.close()
}"""
READ = """async (name) => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('smoke')
  return (await (await dir.getFileHandle(name)).getFile()).text()
}"""

errors = []
checks = {}


def parse_from_sidebar(page, name):
    """侧栏点选 PDF → 抽屉里选“开始解析分块” → 确认配置后开始解析。"""
    page.click(f"aside >> text={name}")
    page.click("[role=dialog] >> text=开始解析分块")
    page.click("[role=dialog] >> button:has-text('开始解析')")

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.add_init_script(FAKE_PICKER)
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE)
    for pdf in (SAMPLE, SAMPLE.with_name("two_column.pdf")):
        page.evaluate(SEED, [pdf.name, base64.b64encode(pdf.read_bytes()).decode()])
    page.screenshot(path=str(OUT / "0_projects.png"))

    # 选择目录 → 进入项目
    page.click("button:has-text('选择目录') >> nth=1")
    page.wait_for_selector("aside >> text=complex_cn.pdf")
    page.screenshot(path=str(OUT / "1_empty.png"))
    checks["空白时不可保存"] = page.locator("button:has-text('保存到目录')").is_disabled()

    # 点选文件 → 抽屉 → 确认配置后转换
    page.click("aside >> text=complex_cn.pdf")
    page.wait_for_selector("[role=dialog] >> text=预览原文件")
    page.screenshot(path=str(OUT / "1b_drawer.png"))
    page.click("[role=dialog] >> text=开始解析分块")
    page.wait_for_selector("[role=dialog] >> text=解析配置")
    page.screenshot(path=str(OUT / "1c_drawer_config.png"))
    page.click("[role=dialog] >> button:has-text('开始解析')")
    page.wait_for_selector("article", timeout=180000)
    time.sleep(0.8)
    page.screenshot(path=str(OUT / "2_chunks.png"))
    n0 = page.locator("article").count()

    max_minus = page.locator("[role=group][aria-label=最多字数] button[aria-label=减少]")
    max_plus = page.locator("[role=group][aria-label=最多字数] button[aria-label=增加]")
    # 改最大字数（1000 → 400）→ 自动重新分块
    for _ in range(6):
        max_minus.click()
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
    page.get_by_label("分隔符", exact=True).fill("@@@")
    page.get_by_label("分隔符", exact=True).press("Enter")
    time.sleep(0.8)
    page.get_by_role("radio", name="Markdown", exact=True).click()
    md = page.locator("textarea").input_value()
    checks["分隔符替换"] = "@@@" in md and "===CHUNK===" not in md and "手工补充的一句话" in md

    # 有编辑时改参数 → 需确认覆盖
    max_plus.click()
    max_plus.click()
    time.sleep(0.8)
    checks["覆盖提示"] = page.locator("text=覆盖编辑并应用").count() == 1

    page.get_by_role("radio", name="预览", exact=True).click()
    time.sleep(0.4)
    page.screenshot(path=str(OUT / "3_preview.png"))

    with page.expect_download() as dl:
        page.click("button[aria-label='下载 .md']")
    dl.value.save_as(str(OUT / "out.md"))
    checks["下载"] = dl.value.suggested_filename == "complex_cn.md" and "@@@" in (OUT / "out.md").read_text()

    # 保存到目录：写成 PDF 旁的同名 .md，导航中标为已转换
    page.keyboard.press("Control+s")
    page.wait_for_selector("button:has-text('已保存')", timeout=10000)
    checks["保存到目录"] = "@@@" in page.evaluate(READ, "complex_cn.md")
    checks["已转换标记"] = page.locator("aside >> text=已转换").count() > 0

    page.get_by_role("radio", name="分块", exact=True).click()
    page.click("article >> nth=1 >> header button >> nth=0")
    time.sleep(0.5)
    checks["页码跳转"] = "#page=" in (page.get_attribute("iframe", "src") or "")

    # 改识别参数 → 出现“重新转换”，确认后用同一文件重新转换
    page.click("aside >> text=全部")
    time.sleep(0.3)
    checks["重新转换按钮"] = page.locator("text=重新转换").count() == 1
    page.once("dialog", lambda d: d.accept())
    page.click("text=重新转换")
    page.wait_for_selector("[role=timer]", timeout=10000)
    page.screenshot(path=str(OUT / "4_converting.png"))
    page.wait_for_selector("article", timeout=180000)
    checks["重新转换完成"] = page.locator("text=重新转换").count() == 0
    page.click("aside >> text=自动")

    # 侧栏换文件：未保存的结果先确认
    page.once("dialog", lambda d: d.accept())
    parse_from_sidebar(page, "two_column.pdf")
    page.wait_for_function("document.querySelector('h1')?.textContent.includes('two_column')", timeout=180000)
    page.wait_for_selector("article", timeout=180000)
    checks["侧栏换文件"] = True

    # 点项目名 → 下拉列出最近项目；选目录后直接切换，不经过首页
    page.click("header button:has-text('smoke')")
    page.wait_for_selector("[role=menuitem]:has-text('smoke')")
    page.screenshot(path=str(OUT / "5_switcher.png"))
    checks["下拉列出最近项目"] = page.locator("[role=menuitem]:has-text('打开其他目录')").count() == 1
    page.once("dialog", lambda d: d.accept())
    page.click("[role=menuitem]:has-text('打开其他目录')")
    page.wait_for_function("!document.querySelector('h1')?.textContent.includes('two_column')", timeout=10000)
    checks["直接切换项目"] = page.locator("text=选择一个项目").count() == 0 and page.locator("aside >> text=已转换").count() > 0
    browser.close()

for k, v in checks.items():
    print(("✓" if v else "✗"), k)
print("页面错误:", errors or "无")
sys.exit(0 if all(checks.values()) and not errors else 1)
