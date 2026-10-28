# 部署

[← 返回 README](../README.md)

## 环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | 监听地址和端口 |
| `STRATUM_WORKERS` | CPU 核数 / 2，取 1 至 3（含） | 解析进程数。每个进程占用 350 MB 内存。 |
| `STRATUM_OCR_THREADS` | CPU 核数 / 进程数 | 每个进程的 OCR 线程数 |
| `STRATUM_MAX_MB` | 200 | 上传文件大小上限，单位 MB |
| `STRATUM_MAX_PAGES` | 2000 | 页数上限 |
| `STRATUM_JOB_TTL` | 10800 | 任务结果和上传文件的保留时长，单位秒 |
| `STRATUM_WORK_DIR` | 系统临时目录 | 上传文件的存放目录 |

> [!CAUTION]
> 服务没有登录鉴权。只在内网部署服务，或把服务放在带鉴权的反向代理后面。

## 性能参考

测试环境：4 核 CPU，无 GPU。

- 文本型 PDF：每页 0.3 至 1 秒。一份 19 页的英文规范用时 9 秒。
- 扫描型 PDF：每页 5 秒（200 dpi，2 个进程）。

## 许可证

> [!WARNING]
> PyMuPDF 和 pymupdf4llm 使用 AGPL-3.0 许可证。内部使用不受影响。如果把本工具作为对外网络服务提供，必须按 AGPL 开源本工具，或购买 Artifex 商业授权。
