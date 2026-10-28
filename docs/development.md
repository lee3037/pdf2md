# 开发

[← 返回 README](../README.md)

## 目录结构

```
app/
  parsers/      解析后端注册表、公共契约、本地方案和 OXR 适配
  extract.py    工作进程：版面分析、OCR、表格框线识别 → 页面结构
  structure.py  页眉页脚清理、标题分级、段落/列表重建、跨页合并
  tables.py     表格清洗、跨页合并、Markdown/键值渲染
  chunker.py    章节分块、上下文、分隔符拼接
  pipeline.py   选择解析后端、汇总警告、调用分块器
  server.py     FastAPI 服务与任务管理
web/            前端源码（React + Tailwind + shadcn）
static/         前端构建产物（已提交）
docs/           文档；docs/assets/ 保存 README 海报及其 HTML 源文件
samples/        示例 PDF 和转换结果
tests/
  make_samples.py   生成测试 PDF（文本型、复杂表格、双栏、扫描型）
  run_sample.py     命令行转换
  test_pipeline.py  转换流水线测试
  test_api.py       接口测试
  ui_smoke.py       浏览器冒烟测试（需另装 playwright）
```

## 扩展解析方案

解析后端遵循 `app/parsers/base.py` 中的 `DocumentParser` 契约。`parse()` 返回 `ParsedDocument`，包含结构化元素、文档统计和解析警告。统一流水线把元素交给 `chunker`，前端无需处理后端原始响应。

1. 在 `app/parsers/` 中实现后端。
2. 在注册表中调用 `register()`。
3. 验证页码、表格结构和重新分块结果。

`id` 是请求中的 `parser` 值，`name` 是界面名称。`local_ocr_options` 控制本地 OCR 参数的显示。`uses_local_workers` 决定任务是否需要本地解析进程池。

`GET /api/parsers` 从注册表生成方案目录。前端读取这个目录，显示可用方案。未传 `parser` 的旧请求仍使用 `pymupdf`。未知方案返回错误。

OXR 通过 `/parse/sync` 返回 JSON。适配器保留块顺序，转换表格网格，再复用标题分级和跨页合并。OXR 不提供行级坐标和字体信息，因此适配器不使用本地的行级段落重建。

## 测试

```bash
.venv/bin/python -m pytest tests -q                  # 全部测试
.venv/bin/python -m pytest tests -q -m "not slow"    # 跳过扫描件用例（这些用例较慢）
.venv/bin/python tests/run_sample.py a.pdf max_chars=800 table_mode=kv   # 命令行转换单个文件
.venv/bin/python tests/run_sample.py a.pdf parser=oxr                 # 调用配置的 OXR 服务
```

调用官方免费 OXR 时，使用允许上传的测试文件。每份文件最多 10 MB、20 页。服务限制和地址配置见[部署](deployment.md#oxr-服务)。

## 前端

前端组件通过 shadcn CLI 从 cult-ui 和 Spectrum UI 注册表引入。注册表配置在 `web/components.json` 中。组件源码保存在 `web/src/components/`，可以直接修改。

```bash
cd web
pnpm install
pnpm dev            # 开发服务器，/api 代理到 http://localhost:8765（可用 STRATUM_API 指定）
pnpm build          # 构建到 ../static
pnpm dlx shadcn@latest add @cult-ui/<组件名>   # 引入新的 cult-ui 组件
```

> [!NOTE]
> 修改前端后，执行 `pnpm build` 并提交 `static/` 目录。

## 品牌素材

- logo：`web/public/favicon.svg` 和 `web/src/components/logo.tsx` 是同一图形。修改时两处保持一致。
- 海报：源文件是 `docs/assets/poster.html`。文件头部注释写了重新生成 `poster.png` 的命令。
