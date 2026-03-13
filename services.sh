#!/bin/bash
# OpenClaw Memory Services - macOS LaunchCtl 管理脚本

set -e

SCRIPT_NAME="$(basename "$0")"
MEMORY_SERVER_LABEL="io.github.liufei.memory-server"
LLAMA_SERVER_LABEL="io.github.liufei.llama-server"
MEMORY_SERVER_PORT=8082
LLAMA_SERVER_PORT=8080

usage() {
    echo "用法：$SCRIPT_NAME {start|stop|restart|status|logs}"
    echo ""
    echo "命令:"
    echo "  start    - 启动所有服务 (llama-server + memory-server)"
    echo "  stop     - 停止所有服务"
    echo "  restart  - 重启所有服务"
    echo "  status   - 查看服务状态"
    echo "  logs     - 查看日志 (tail -f)"
    echo ""
    echo "示例:"
    echo "  $SCRIPT_NAME start"
    echo "  $SCRIPT_NAME status"
    echo "  $SCRIPT_NAME logs memory    # 只看 memory-server 日志"
    echo "  $SCRIPT_NAME logs llama     # 只看 llama-server 日志"
    exit 1
}

check_service() {
    local label=$1
    launchctl list | grep -q "$label"
}

start_service() {
    local label=$1
    local plist="$HOME/Library/LaunchAgents/${label}.plist"

    if check_service "$label"; then
        echo "[跳过] $label 已经在运行"
    else
        launchctl load "$plist" 2>/dev/null || launchctl bootstrap gui/$(id -u) "$plist"
        echo "[启动] $label"
    fi
}

stop_service() {
    local label=$1
    if check_service "$label"; then
        launchctl unload "$HOME/Library/LaunchAgents/${label}.plist" 2>/dev/null || true
        launchctl bootout gui/$(id -u)/"$label" 2>/dev/null || true
        echo "[停止] $label"
    else
        echo "[跳过] $label 未运行"
    fi
}

show_status() {
    echo "=== 服务状态 ==="
    echo ""

    echo "LLAMA-SERVER (端口 $LLAMA_SERVER_PORT):"
    if check_service "$LLAMA_SERVER_LABEL"; then
        echo "  ✓ 运行中"
        curl -s http://localhost:$LLAMA_SERVER_PORT/health > /dev/null 2>&1 && echo "  ✓ 健康检查通过" || echo "  ✗ 健康检查失败"
    else
        echo "  ✗ 未运行"
    fi
    echo ""

    echo "MEMORY-SERVER (端口 $MEMORY_SERVER_PORT):"
    if check_service "$MEMORY_SERVER_LABEL"; then
        echo "  ✓ 运行中"
        curl -s http://localhost:$MEMORY_SERVER_PORT/health > /dev/null 2>&1 && echo "  ✓ 健康检查通过" || echo "  ✗ 健康检查失败"
    else
        echo "  ✗ 未运行"
    fi
}

show_logs() {
    local target=$1
    local memory_log="$HOME/Library/Logs/memory-server.log"
    local llama_log="$HOME/Library/Logs/llama-server.log"

    case "$target" in
        memory)
            echo "=== Memory Server 日志 ($memory_log) ==="
            tail -f "$memory_log"
            ;;
        llama)
            echo "=== Llama Server 日志 ($llama_log) ==="
            tail -f "$llama_log"
            ;;
        *)
            echo "=== 同时查看两个日志 ==="
            tail -f "$memory_log" "$llama_log"
            ;;
    esac
}

case "${1:-}" in
    start)
        echo "启动 OpenClaw Memory 服务..."
        start_service "$LLAMA_SERVER_LABEL"
        sleep 1
        start_service "$MEMORY_SERVER_LABEL"
        echo ""
        echo "启动完成!"
        ;;

    stop)
        echo "停止 OpenClaw Memory 服务..."
        stop_service "$MEMORY_SERVER_LABEL"
        stop_service "$LLAMA_SERVER_LABEL"
        echo ""
        echo "停止完成!"
        ;;

    restart)
        echo "重启 OpenClaw Memory 服务..."
        stop_service "$MEMORY_SERVER_LABEL"
        stop_service "$LLAMA_SERVER_LABEL"
        sleep 1
        start_service "$LLAMA_SERVER_LABEL"
        sleep 2
        start_service "$MEMORY_SERVER_LABEL"
        echo ""
        echo "重启完成!"
        ;;

    status)
        show_status
        ;;

    logs)
        show_logs "${2:-all}"
        ;;

    *)
        usage
        ;;
esac
