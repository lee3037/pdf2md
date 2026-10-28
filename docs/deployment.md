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

## OXR 服务

Stratum 通过 HTTP 调用 OXR，不在本机加载 OXR 模型。默认地址为 `https://free-oxr.somark.ai/api/v1`。官方免费服务用于试用，不保证可用性和处理时长。

官方免费接口限制每份文件 10 MB、20 页。这个限制也适用于镜像。详情见[官方免费接口文档](https://docs.somark.ai/en/api-reference/oxr/index.md)。

通过服务器环境变量配置服务：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STRATUM_OXR_BASE_URL` | `https://free-oxr.somark.ai/api/v1` | OXR API 根地址，包含版本路径，不含 `/parse/sync`。 |
| `STRATUM_OXR_API_KEY` | `dummy` | 官方免费接口使用占位值。自托管服务按服务要求配置。 |
| `STRATUM_OXR_TIMEOUT` | `300` | HTTP 超时时长，单位秒。连接超时最多 30 秒。 |

使用官方镜像：

```bash
STRATUM_OXR_BASE_URL=https://free-oxr.somark.cn/api/v1 ./run.sh
```

使用自托管 OXR：

```bash
STRATUM_OXR_BASE_URL=http://127.0.0.1:9000/v1 ./run.sh
```

服务地址与密钥只在服务端使用。浏览器通过 Stratum 提交 PDF。选择 OXR 后，Stratum 将整份 PDF 上传到指定服务。

OXR 的文件大小和页数限制独立于 Stratum。上游拒绝文件、排队超时或返回解析错误时，Stratum 显示错误，不自动切换服务或解析方案。

## 性能参考

以下数据适用于默认的 PyMuPDF + RapidOCR 方案。测试环境为 4 核 CPU，无 GPU。

- 文本型 PDF：每页 0.3 至 1 秒。一份 19 页的英文规范用时 9 秒。
- 扫描型 PDF：每页 5 秒（200 dpi，2 个进程）。

## 许可证

> [!WARNING]
> PyMuPDF 和 pymupdf4llm 使用 AGPL-3.0 许可证。内部使用不受影响。如果把本工具作为对外网络服务提供，必须按 AGPL 开源本工具，或购买 Artifex 商业授权。

OXR 使用附加商业限制的自定义许可证。自托管或对外提供服务前，核对 [OXR 许可证](https://github.com/SoMarkAI/OXR/blob/main/LICENSE)与所用服务的条款。
