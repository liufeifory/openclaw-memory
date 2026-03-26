#!/bin/bash
# OpenClaw Memory Services Manager
# Supports macOS (launchd) and Linux (systemd)
#
# Usage:
#   ./services.sh start|stop|restart|status|logs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="$(basename "$0")"

# Service configuration
LLAMA_SERVER_LABEL="io.github.liufei.llama-server"
LLAMA_EMBEDDING_LABEL="io.github.liufei.llama-server-embedding"
LLAMA_7B_LABEL="io.github.liufei.llama-server-7b"
SURREALDB_LABEL="io.github.liufei.surrealdb"
LLAMA_SERVER_PORT=8080
LLAMA_7B_PORT=8082
SURREALDB_PORT=8000

# Detect OS
OS="unknown"
INIT_SYSTEM="unknown"

detect_os() {
    case "$(uname -s)" in
        Darwin*)
            OS="macos"
            INIT_SYSTEM="launchd"
            ;;
        Linux*)
            OS="linux"
            if command -v systemctl &> /dev/null; then
                INIT_SYSTEM="systemd"
            fi
            ;;
    esac
}

detect_os

# Log colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

usage() {
    cat << EOF
OpenClaw Memory Services Manager

用法：$SCRIPT_NAME <command> [options]

命令:
  start          启动所有服务
  stop           停止所有服务
  restart        重启所有服务
  status         查看服务状态
  logs [target]  查看日志 (all|embedding|7b|surrealdb)

示例:
  $SCRIPT_NAME start          # 启动所有服务
  $SCRIPT_NAME status         # 查看状态
  $SCRIPT_NAME logs embedding # 只看 Embedding 服务日志
  $SCRIPT_NAME logs 7b        # 只看 7B LLM 服务日志
  $SCRIPT_NAME logs surrealdb # 只看 SurrealDB 日志

EOF
    exit 1
}

check_service() {
    local label=$1
    if [ "$INIT_SYSTEM" = "launchd" ]; then
        launchctl list | grep -q "$label" 2>/dev/null
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user is-active "$label" > /dev/null 2>&1
    fi
}

start_service() {
    local label=$1
    local display_name=$2

    if check_service "$label"; then
        log_warn "$display_name 已经在运行"
        return 0
    fi

    if [ "$INIT_SYSTEM" = "launchd" ]; then
        launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null || \
        launchctl load "$HOME/Library/LaunchAgents/${label}.plist" 2>/dev/null
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user start "$label"
    fi

    log_success "已启动：$display_name"
}

stop_service() {
    local label=$1
    local display_name=$2

    if ! check_service "$label"; then
        log_warn "$display_name 未运行"
        return 0
    fi

    if [ "$INIT_SYSTEM" = "launchd" ]; then
        launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user stop "$label"
    fi

    log_success "已停止：$display_name"
}

show_health() {
    local port=$1
    local name=$2
    local url="http://localhost:$port/"

    if curl -s --connect-timeout 2 "$url" > /dev/null 2>&1; then
        echo -e "    ${GREEN}✓ 健康${NC}"
    else
        echo -e "    ${YELLOW}○ 响应超时${NC}"
    fi
}

show_status() {
    echo ""
    echo "=== OpenClaw Memory 服务状态 ==="
    echo ""

    echo "LLAMA-SERVER (Embedding BGE-M3 @ 端口 $LLAMA_SERVER_PORT):"
    if check_service "$LLAMA_EMBEDDING_LABEL"; then
        echo -e "  ${GREEN}✓ 运行中${NC}"
        show_health $LLAMA_SERVER_PORT "llama-server-embedding"
    else
        echo -e "  ${RED}✗ 未运行${NC}"
    fi
    echo ""

    echo "LLAMA-SERVER (LLM Qwen2.5-7B @ 端口 $LLAMA_7B_PORT):"
    if check_service "$LLAMA_7B_LABEL"; then
        echo -e "  ${GREEN}✓ 运行中${NC}"
        show_health $LLAMA_7B_PORT "llama-server-7b"
    else
        echo -e "  ${RED}✗ 未运行${NC}"
    fi
    echo ""

    echo "SURREALDB (端口 $SURREALDB_PORT):"
    if check_service "$SURREALDB_LABEL"; then
        echo -e "  ${GREEN}✓ 运行中${NC}"
        show_health $SURREALDB_PORT "surrealdb"
    else
        echo -e "  ${RED}✗ 未运行${NC}"
    fi
    echo ""
}

show_logs() {
    local target=${1:-all}
    local embedding_log="$HOME/Library/Logs/llama-server-embedding.log"
    local llm_7b_log="$HOME/Library/Logs/llama-server-7b.log"
    local surrealdb_log="$HOME/Library/Logs/surrealdb.log"

    if [ "$OS" = "linux" ]; then
        embedding_log="$HOME/.local/log/llama-server-embedding.log"
        llm_7b_log="$HOME/.local/log/llama-server-7b.log"
        surrealdb_log="$HOME/.local/log/surrealdb.log"
    fi

    case "$target" in
        embedding|8080)
            echo "=== Embedding 服务日志 ($embedding_log) ==="
            tail -fn 100 "$embedding_log"
            ;;
        7b|llm-7b|8082)
            echo "=== 7B LLM 服务日志 ($llm_7b_log) ==="
            tail -fn 100 "$llm_7b_log"
            ;;
        surrealdb|surrealdb-server)
            echo "=== SurrealDB 日志 ($surrealdb_log) ==="
            tail -fn 100 "$surrealdb_log"
            ;;
        *)
            echo "=== 实时日志流 ==="
            tail -f "$embedding_log" "$llm_7b_log" "$surrealdb_log" 2>/dev/null
            ;;
    esac
}

start_all() {
    log_info "启动 OpenClaw Memory 服务..."
    start_service "$LLAMA_EMBEDDING_LABEL" "llama-server-embedding (BGE-M3)"
    sleep 2
    start_service "$LLAMA_7B_LABEL" "llama-server-7b (Qwen2.5-7B)"
    sleep 2
    start_service "$SURREALDB_LABEL" "SurrealDB"
    sleep 2

    echo ""
    log_info "等待服务就绪..."
    show_status
}

stop_all() {
    log_info "停止 OpenClaw Memory 服务..."
    stop_service "$SURREALDB_LABEL" "SurrealDB"
    stop_service "$LLAMA_7B_LABEL" "llama-server-7b (Qwen2.5-7B)"
    stop_service "$LLAMA_EMBEDDING_LABEL" "llama-server-embedding (BGE-M3)"
    echo ""
    log_success "所有服务已停止"
}

restart_all() {
    log_info "重启 OpenClaw Memory 服务..."
    stop_all
    sleep 2
    start_all
}

# Main
case "${1:-status}" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-all}"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        log_error "未知命令：$1"
        usage
        ;;
esac
