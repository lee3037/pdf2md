"""浏览器端冒烟测试（需另装 playwright）：python tests/ui_smoke.py [http://localhost:8000/] [截图目录]"""
import base64
import hashlib
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/stratum-ui")
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

def version_link(page, name):
    return page.get_by_role("navigation", name="Markdown 产物").get_by_text(name, exact=True)


def open_reparse(page):
    page.get_by_role("group", name="Markdown 产物操作").hover()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="重新解析分块", exact=True).click()
    drawer = page.get_by_role("dialog")
    drawer.wait_for()
    return drawer


def confirm_reparse(page, name):
    page.get_by_role("dialog").get_by_role("button", name="重新解析分块", exact=True).click()
    version_link(page, name).wait_for(timeout=180000)
    page.get_by_role("dialog").wait_for(state="detached")


def save_current(page):
    page.get_by_role("button", name="保存到目录", exact=True).click()
    page.get_by_role("button", name="已保存", exact=True).wait_for()
    page.get_by_role("button", name="保存到目录", exact=True).wait_for()


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.add_init_script(FAKE_PICKER)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(BASE)
    for pdf in (SAMPLE, SAMPLE.with_name("two_column.pdf")):
        page.evaluate(SEED, [pdf.name, base64.b64encode(pdf.read_bytes()).decode()])
    page.click("button:has-text('选择目录') >> nth=1")
    checks["空白时无产物操作"] = page.get_by_role("group", name="Markdown 产物操作").count() == 0
    checks["侧栏无配置"] = page.locator("aside").get_by_text("识别", exact=True).count() == 0

    # 添加按钮将 PDF 复制到项目目录，不自动开始解析。
    pdf_bytes = SAMPLE.read_bytes()
    add_button = page.get_by_role("button", name="添加 PDF", exact=True)
    with page.expect_file_chooser() as chooser:
        add_button.click()
    chooser.value.set_files({"name": "added.pdf", "mimeType": "application/pdf", "buffer": pdf_bytes})
    page.locator('aside a[href="#added.pdf"]').wait_for()
    read_added = """async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('smoke');
        const file = await (await dir.getFileHandle('added.pdf')).getFile();
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    }"""
    checks["添加 PDF 写入项目目录"] = page.evaluate(read_added) == hashlib.sha256(pdf_bytes).hexdigest()
    checks["添加 PDF 后等待选择操作"] = page.get_by_role("dialog").count() == 0 and page.get_by_role("group", name="Markdown 产物操作").count() == 0
    with page.expect_file_chooser() as chooser:
        add_button.click()
    chooser.value.set_files({"name": "added.pdf", "mimeType": "application/pdf", "buffer": b"different content"})
    page.get_by_text("项目目录中已存在 added.pdf", exact=True).wait_for()
    checks["添加同名 PDF 保留原文件"] = page.evaluate(read_added) == hashlib.sha256(pdf_bytes).hexdigest()

    parse_from_sidebar(page, SAMPLE.name)
    version_link(page, "complex_cn_v1.md").wait_for(timeout=180000)
    n0 = page.locator("article").count()
    checks["首次生成 v1"] = n0 > 0
    nav = page.get_by_role("navigation", name="Markdown 产物")
    checks["Markdown 标题"] = nav.get_by_text("Markdown 1", exact=True).count() == 1
    checks["页头无导出操作"] = page.locator("header").first.get_by_role("button", name="保存到目录", exact=True).count() == 0
    bar = page.get_by_role("group", name="Markdown 产物操作")
    page.mouse.move(5, 5)
    page.wait_for_timeout(500)
    width = bar.bounding_box()["width"]
    copy = page.get_by_role("button", name="复制 Markdown", exact=True)
    copy.hover()
    page.wait_for_timeout(500)
    checks["操作栏悬停展开"] = bar.bounding_box()["width"] > width
    checks["按钮无额外文字提示"] = bar.locator("button[title]").count() == 0
    action_font = copy.evaluate("el => getComputedStyle(el).fontSize")
    checks["操作栏使用小字号"] = action_font == "12px"
    view_height = page.get_by_role("radiogroup", name="结果视图").bounding_box()["height"]
    checks["操作栏与视图切换等高"] = abs(bar.bounding_box()["height"] - view_height) < 1
    copy.click()
    checks["复制 Markdown"] = "预算" in page.evaluate("navigator.clipboard.readText()")
    save_current(page)
    v1 = page.evaluate(READ, "complex_cn_v1.md")
    checks["保存 v1"] = "预算" in v1

    # 修改配置后取消，不创建版本，也不修改当前产物。
    drawer = open_reparse(page)
    minus = drawer.locator("[role=group][aria-label=最多字数] button[aria-label=减少]")
    for _ in range(6):
        minus.click()
    drawer.get_by_role("button", name="取消", exact=True).click()
    checks["取消不创建版本"] = version_link(page, "complex_cn_v2.md").count() == 0
    drawer = open_reparse(page)
    checks["取消恢复配置"] = "1000" in drawer.locator("[role=group][aria-label=最多字数]").inner_text()
    for _ in range(6):
        minus.click()
    confirm_reparse(page, "complex_cn_v2.md")
    checks["重新分块生成 v2"] = page.locator("article").count() > n0
    checks["生成不覆盖磁盘 v1"] = page.evaluate(READ, "complex_cn_v1.md") == v1

    # v2 尚未保存：编辑后生成 v3，返回 v2 时编辑仍在。
    page.get_by_role("radio", name="Markdown", exact=True).click()
    v2 = page.locator("textarea").input_value() + "\n手工补充的一句话。\n"
    page.locator("textarea").fill(v2)
    drawer = open_reparse(page)
    drawer.locator("[role=group][aria-label=最多字数] button[aria-label=增加]").click()
    confirm_reparse(page, "complex_cn_v3.md")
    version_link(page, "complex_cn_v2.md").click()
    page.get_by_role("radio", name="Markdown", exact=True).click()
    checks["未保存旧版保留编辑"] = page.locator("textarea").input_value() == v2
    save_current(page)
    checks["保存旧版不覆盖 v1"] = page.evaluate(READ, "complex_cn_v1.md") == v1 and page.evaluate(READ, "complex_cn_v2.md") == v2

    # 从旧版本生成时仍按全局最大编号递增；仅改分隔符保留这次编辑。
    drawer = open_reparse(page)
    drawer.get_by_label("分隔符", exact=True).fill("@@@")
    drawer.get_by_label("分隔符", exact=True).press("Enter")
    confirm_reparse(page, "complex_cn_v4.md")
    page.get_by_role("radio", name="Markdown", exact=True).click()
    v4 = page.locator("textarea").input_value()
    checks["旧版生成继续递增"] = "@@@" in v4 and "手工补充的一句话" in v4 and "===CHUNK===" not in v4
    with page.expect_download() as download:
        page.get_by_role("button", name="下载 .md", exact=True).click()
    download.value.save_as(str(OUT / "out.md"))
    checks["下载使用版本文件名"] = download.value.suggested_filename == "complex_cn_v4.md" and (OUT / "out.md").read_text() == v4
    save_current(page)
    checks["新旧版本分别保存"] = page.evaluate(READ, "complex_cn_v4.md") == v4 and page.evaluate(READ, "complex_cn_v2.md") == v2
    page.get_by_role("radio", name="分块", exact=True).click()
    page.click("article >> nth=1 >> header button >> nth=0")
    checks["页码跳转"] = "#page=" in (page.get_attribute("iframe", "src") or "")

    # OXR 不使用本地 OCR 参数，只保留去页眉页脚。
    drawer = open_reparse(page)
    drawer.get_by_role("radio", name="OXR").click()
    checks["OXR 隐藏本地 OCR 参数"] = (
        drawer.get_by_role("radiogroup", name="OCR", exact=True).count() == 0
        and drawer.get_by_text("去页眉页脚", exact=True).count() == 1
    )
    drawer.get_by_role("button", name="取消", exact=True).click()
    drawer.wait_for(state="detached")

    # 修改识别参数会重新解析 PDF，旧版本仍保留。
    drawer = open_reparse(page)
    drawer.get_by_role("radio", name="全部", exact=True).click()
    with page.expect_request(lambda r: r.method == "POST" and r.url.endswith("/api/jobs")):
        confirm_reparse(page, "complex_cn_v5.md")
    checks["重新解析生成 v5"] = page.evaluate(READ, "complex_cn_v4.md") == v4
    version_link(page, "complex_cn_v1.md").click()
    page.locator('aside a[href="#complex_cn.pdf"]').click()
    checks["点击已转换 PDF 打开最新会话版本"] = "complex_cn_v5.md" in page.get_by_role("navigation", name="Markdown 产物").locator('a[aria-current="page"]').inner_text()
    if page.get_by_role("button", name="收起原文", exact=True).count():
        page.get_by_role("button", name="收起原文", exact=True).click()
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / "versions.png"))

    parse_from_sidebar(page, "two_column.pdf")
    version_link(page, "two_column_v1.md").wait_for(timeout=180000)
    checks["不同 PDF 独立编号"] = True
    version_link(page, "complex_cn_v3.md").click()
    checks["切换 PDF 保留未保存版本"] = page.locator("header").first.locator("h1").inner_text() == "complex_cn.pdf"

    # 重开项目后按磁盘最大版本继续递增，不复用缺失的 v3。
    page.click("header button:has-text('smoke')")
    page.once("dialog", lambda d: d.accept())
    page.get_by_role("menuitem", name="打开其他目录").click()
    page.locator('aside a[href="#complex_cn.pdf"]').click()
    page.get_by_role("radio", name="Markdown", exact=True).click()
    checks["点击已转换 PDF 打开最新保存版本"] = page.locator("textarea").input_value() == v4
    if page.get_by_role("button", name="对照原文", exact=True).count():
        page.get_by_role("button", name="对照原文", exact=True).click()
    checks["本地产物对照原文"] = (page.get_attribute("iframe", "src") or "").startswith("blob:")
    open_reparse(page)
    confirm_reparse(page, "complex_cn_v5.md")
    checks["重开后按最大版本递增"] = version_link(page, "complex_cn_v3.md").count() == 0
    context.close()

    # 旧版无后缀文件按 v1 计数；触屏先展开操作栏，再执行操作。
    touch_context = browser.new_context(viewport={"width": 1024, "height": 768}, has_touch=True)
    touch_context.add_init_script(FAKE_PICKER)
    touch_page = touch_context.new_page()
    touch_page.on("pageerror", lambda e: errors.append(str(e)))
    touch_page.goto(BASE)
    touch_page.evaluate(SEED, [SAMPLE.name, base64.b64encode(SAMPLE.read_bytes()).decode()])
    legacy = "# 已保存的旧产物\n"
    touch_page.evaluate(SEED, ["complex_cn.md", base64.b64encode(legacy.encode()).decode()])
    touch_page.click("button:has-text('选择目录') >> nth=1")
    version_link(touch_page, "complex_cn.md").click()
    touch_action = touch_page.get_by_role("button", name="重新解析分块", exact=True)
    touch_action.tap()
    checks["触屏首次点击仅展开"] = touch_page.get_by_role("dialog").count() == 0
    touch_action.tap()
    touch_page.get_by_role("dialog").wait_for()
    checks["触屏再次点击打开抽屉"] = True
    touch_page.get_by_role("dialog").get_by_role("button", name="取消", exact=True).tap()
    touch_page.get_by_role("dialog").wait_for(state="detached")
    touch_page.get_by_role("button", name="复制 Markdown", exact=True).focus()
    touch_page.keyboard.press("Tab")
    checks["操作栏键盘导航"] = touch_page.get_by_role("button", name="下载 .md", exact=True).evaluate("el => el === document.activeElement")
    open_reparse(touch_page)
    confirm_reparse(touch_page, "complex_cn_v2.md")
    save_current(touch_page)
    checks["兼容旧文件且不覆盖"] = touch_page.evaluate(READ, "complex_cn.md") == legacy
    touch_context.close()
    browser.close()

for k, v in checks.items():
    print(("✓" if v else "✗"), k)
print("页面错误:", errors or "无")
sys.exit(0 if all(checks.values()) and not errors else 1)
