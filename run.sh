#!/usr/bin/env bash
# 启动 PDF → FastGPT Markdown 服务。用法：./run.sh [端口]，默认 8000
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-${PORT:-8000}}"
HOST="${HOST:-0.0.0.0}"
if [ ! -x .venv/bin/python ]; then
  echo "首次运行：创建虚拟环境并安装依赖…"
  if command -v uv >/dev/null 2>&1; then
    uv venv -q .venv --python 3.12
    uv pip install -q --python .venv/bin/python -r requirements.txt
  else
    python3 -m venv .venv
    .venv/bin/pip install -q -r requirements.txt
  fi
fi
exec .venv/bin/python -m uvicorn app.server:app --host "$HOST" --port "$PORT"
