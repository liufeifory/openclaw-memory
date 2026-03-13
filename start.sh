#!/bin/bash
# OpenClaw Memory Plugin - 快速启动脚本

set -e

# 配置
PORT=${MEMORY_SERVER_PORT:-8082}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  OpenClaw Memory Plugin 启动脚本"
echo "========================================"

# 检查 PostgreSQL 是否运行
if ! pgrep -x postgres > /dev/null; then
    echo "[错误] PostgreSQL 未运行"
    exit 1
fi
echo "[OK] PostgreSQL 运行中"

# 检查 llama.cpp embedding 服务
if ! curl -s http://127.0.0.1:8080/embedding -X POST -d '{"input":"test"}' > /dev/null 2>&1; then
    echo "[警告] llama.cpp embedding 服务未运行在 8080 端口"
    echo "       请启动：llama-server --hf-repo lm-kit/bge-m3-gguf --embedding --port 8080"
else
    echo "[OK] Embedding 服务运行中 (端口 8080)"
fi

# 检查数据库连接
if ! psql -U liufei -d openclaw_memory -c "SELECT 1" > /dev/null 2>&1; then
    echo "[错误] 无法连接到数据库 openclaw_memory"
    echo "       请确保：1) 数据库存在 2) 用户 liufei 有访问权限"
    exit 1
fi
echo "[OK] 数据库连接正常"

# 启动记忆服务
echo "[启动] 记忆服务 (端口 $PORT)"
cd "$SCRIPT_DIR"
python3 memory_server.py --port "$PORT"
