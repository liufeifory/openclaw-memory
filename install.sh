#!/bin/bash
# OpenClaw Memory Plugin - 安装部署脚本
#
# 用法：
#   ./install.sh              # 完整安装
#   ./install.sh --deps       # 只安装依赖
#   ./install.sh --services   # 只配置服务
#   ./install.sh --check      # 检查安装状态

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# 检查命令是否存在
check_cmd() {
    command -v "$1" >/dev/null 2>&1
}

# 检查服务是否运行
check_service() {
    local label=$1
    launchctl list | grep -q "$label" 2>/dev/null
}

# 打印横幅
print_banner() {
    echo ""
    echo "=========================================="
    echo "  OpenClaw Memory Plugin 安装脚本"
    echo "=========================================="
    echo ""
}

# 检查系统依赖
check_dependencies() {
    log_info "检查系统依赖..."

    local missing=()

    # 检查 Node.js
    if check_cmd node; then
        local node_ver=$(node -v 2>/dev/null || echo "unknown")
        log_success "Node.js: $node_ver"
    else
        missing+=("node")
        log_error "Node.js: 未安装 (需要 >= 18)"
    fi

    # 检查 npm
    if check_cmd npm; then
        local npm_ver=$(npm -v 2>/dev/null || echo "unknown")
        log_success "npm: $npm_ver"
    else
        missing+=("npm")
        log_error "npm: 未安装"
    fi

    # 检查 SurrealDB
    if check_cmd surreal; then
        local surreal_ver=$(surreal version 2>/dev/null | head -1 || echo "unknown")
        log_success "SurrealDB: $surreal_ver"
    else
        missing+=("surrealdb")
        log_warn "SurrealDB: 未安装 (brew install surrealdb)"
    fi

    # 检查 llama.cpp
    if check_cmd llama-server; then
        log_success "llama.cpp: 已安装"
    else
        missing+=("llama.cpp")
        log_warn "llama.cpp: 未安装 (brew install llama.cpp)"
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo ""
        log_info "安装缺失的依赖："
        echo "  brew install node surrealdb llama.cpp"
    fi
}

# 安装 Node.js 依赖
install_deps() {
    log_info "安装 Node.js 依赖..."
    npm install
    log_success "依赖安装完成"

    log_info "构建插件..."
    npm run build
    log_success "构建完成"
}

# 配置 LaunchAgent 服务
setup_services() {
    log_info "配置 LaunchAgent 服务..."

    local plist_dir="$HOME/Library/LaunchAgents"
    local logs_dir="$HOME/Library/Logs"

    mkdir -p "$logs_dir"

    # 检查 openclaw.json 配置
    local config_file="$HOME/.openclaw/openclaw.json"
    if [ ! -f "$config_file" ]; then
        log_warn "OpenClaw 配置文件不存在：$config_file"
        log_info "请先配置 OpenClaw"
    fi

    log_success "服务配置完成"
    echo ""
    log_info "使用以下命令启动服务："
    echo "  cd $SCRIPT_DIR"
    echo "  ./services.sh start"
}

# 显示使用指南
show_usage_guide() {
    echo ""
    echo "=========================================="
    echo "  安装完成！"
    echo "=========================================="
    echo ""
    echo "下一步操作："
    echo ""
    echo "1. 启动所有服务："
    echo "   ./services.sh start"
    echo ""
    echo "2. 查看服务状态："
    echo "   ./services.sh status"
    echo ""
    echo "3. 配置 OpenClaw (~/.openclaw/openclaw.json)："
    echo '   {'
    echo '     "plugins": {'
    echo '       "slots": { "memory": "openclaw-memory" },'
    echo '       "openclaw-memory": {'
    echo '         "backend": "surrealdb",'
    echo '         "surrealdb": {'
    echo '           "url": "ws://localhost:8000/rpc",'
    echo '           "namespace": "openclaw",'
    echo '           "database": "memory",'
    echo '           "username": "root",'
    echo '           "password": "root"'
    echo '         },'
    echo '         "embedding": { "endpoint": "http://localhost:8080" }'
    echo '       }'
    echo '     }'
    echo '   }'
    echo ""
    echo "4. 重启 OpenClaw："
    echo "   openclaw gateway restart"
    echo ""
    echo "5. 验证插件："
    echo "   openclaw plugins info openclaw-memory"
    echo ""
    echo "文档："
    echo "  - README.md          快速开始指南"
    echo "  - LLM-MODELS.md      本地大模型部署说明"
    echo "  - CONFIG.md          完整配置选项"
    echo "  - USAGE.md           使用指南"
    echo ""
}

# 主函数
main() {
    print_banner

    case "${1:-install}" in
        --check)
            check_dependencies
            ;;
        --deps)
            install_deps
            ;;
        --services)
            setup_services
            ;;
        install|"")
            check_dependencies
            echo ""
            read -p "是否继续安装？[y/N] " confirm
            if [[ "$confirm" =~ ^[Yy]$ ]]; then
                install_deps
                setup_services
                show_usage_guide
            fi
            ;;
        *)
            echo "用法：$0 [--check|--deps|--services]"
            exit 1
            ;;
    esac
}

main "$@"
