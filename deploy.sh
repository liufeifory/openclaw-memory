#!/bin/bash
# OpenClaw Memory Plugin - One-Click Deployment Script
# Supports macOS (launchd) and Linux (systemd)
#
# Features:
# - Install llama.cpp embedding service
# - Install Qdrant vector database
# - Configure auto-start on boot
# - Setup OpenClaw configuration
#
# Usage:
#   ./deploy.sh install    - Install and setup everything
#   ./deploy.sh uninstall  - Remove all services and files
#   ./deploy.sh status     - Check service status
#   ./deploy.sh logs       - View logs
#   ./deploy.sh start      - Start all services
#   ./deploy.sh stop       - Stop all services
#   ./deploy.sh restart    - Restart all services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="openclaw-memory"
OPENCLAW_DIR="$HOME/.openclaw"
PLUGIN_DIR="$OPENCLAW_DIR/plugins/$PLUGIN_NAME"

# Service configuration
LLAMA_SERVER_LABEL="io.github.liufei.llama-server"
QDRANT_LABEL="io.github.liufei.qdrant"
LLAMA_SERVER_PORT=8080
QDRANT_PORT=6333

# llama.cpp configuration
# llama-server will auto-download the model if not present
LLAMA_SERVER_REPO="lm-kit/bge-m3-gguf"
LLAMA_SERVER_MODEL="bge-m3-Q8_0.gguf"
LLAMA_SERVER_ARGS="--hf-repo $LLAMA_SERVER_REPO --hf-file $LLAMA_SERVER_MODEL --embedding --port $LLAMA_SERVER_PORT --ctx-size 8192"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect OS and init system
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
            else
                INIT_SYSTEM="sysvinit"
            fi
            ;;
        *)
            log_error "Unsupported OS: $(uname -s)"
            exit 1
            ;;
    esac
    echo "Detected OS: $OS, Init System: $INIT_SYSTEM"
}

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    local missing=()

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if ! command -v node &> /dev/null; then
        missing+=("nodejs")
    fi

    # Check for homebrew on macOS
    if [ "$OS" = "macos" ] && ! command -v brew &> /dev/null; then
        log_error "Homebrew not found. Please install first: https://brew.sh"
        exit 1
    fi

    # Check for llama-server
    if ! command -v llama-server &> /dev/null; then
        log_warn "llama-server not found. Installing via homebrew..."
        brew install llama.cpp
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing dependencies: ${missing[*]}"
        log_info "Please install them first:"
        if command -v brew &> /dev/null; then
            echo "  brew install ${missing[*]}"
        elif command -v apt &> /dev/null; then
            echo "  sudo apt install ${missing[*]}"
        elif command -v yum &> /dev/null; then
            echo "  sudo yum install ${missing[*]}"
        fi
        exit 1
    fi

    log_success "All dependencies satisfied"
}

# Download and setup llama.cpp
setup_llama_cpp() {
    log_info "Setting up llama.cpp..."

    # llama-server is already installed via check_dependencies
    local LLAMA_BINARY=$(which llama-server)
    log_success "Found llama-server: $LLAMA_BINARY"

    # Create directory for cache
    local LLAMA_DIR="$PLUGIN_DIR/llama.cpp"
    mkdir -p "$LLAMA_DIR"

    # Store llama binary path - model will be auto-downloaded by llama-server on first run
    echo "$LLAMA_BINARY" > "$LLAMA_DIR/llama_path"
    log_success "llama.cpp ready (model will auto-download on first run)"
}

# Download and setup Qdrant
setup_qdrant() {
    log_info "Setting up Qdrant..."

    local QDRANT_VERSION="1.12.4"
    local QDRANT_DIR="$PLUGIN_DIR/qdrant"
    local QDRANT_BINARY="$QDRANT_DIR/qdrant"
    local CONFIG_FILE="$QDRANT_DIR/config.yaml"
    local STORAGE_DIR="$QDRANT_DIR/storage"

    mkdir -p "$QDRANT_DIR"
    mkdir -p "$STORAGE_DIR"

    if [ ! -f "$QDRANT_BINARY" ]; then
        # Detect platform
        local PLATFORM=""
        case "$(uname -s)" in
            Darwin*)
                PLATFORM="x86_64-apple-darwin"
                [[ "$(uname -m)" == "arm64" ]] && PLATFORM="aarch64-apple-darwin"
                ;;
            Linux*)
                PLATFORM="x86_64-unknown-linux-gnu"
                ;;
            *)
                log_error "Unsupported platform for Qdrant"
                exit 1
                ;;
        esac

        log_info "Downloading Qdrant $QDRANT_VERSION ($PLATFORM)..."
        local DOWNLOAD_URL="https://github.com/qdrant/qdrant/releases/download/v$QDRANT_VERSION/qdrant-$PLATFORM.tar.gz"
        curl -L -o "$QDRANT_DIR/qdrant.tar.gz" "$DOWNLOAD_URL"
        tar -xzf "$QDRANT_DIR/qdrant.tar.gz" -C "$QDRANT_DIR"
        rm "$QDRANT_DIR/qdrant.tar.gz"
        chmod +x "$QDRANT_BINARY"
        log_success "Qdrant downloaded to: $QDRANT_BINARY"
    else
        log_success "Qdrant already exists: $QDRANT_BINARY"
    fi

    # Create config if not exists
    if [ ! -f "$CONFIG_FILE" ]; then
        log_info "Creating Qdrant config..."
        cat > "$CONFIG_FILE" << EOF
storage:
  storage_path: $STORAGE_DIR

service:
  host: 127.0.0.1
  http_port: $QDRANT_PORT

log_level: INFO
EOF
        log_success "Config created: $CONFIG_FILE"
    fi

    # Store paths
    echo "$QDRANT_BINARY" > "$QDRANT_DIR/qdrant_path"
    echo "$CONFIG_FILE" > "$QDRANT_DIR/config_path"
}

# Setup macOS launchd services
setup_launchd_services() {
    log_info "Setting up macOS launchd services..."

    local AGENTS_DIR="$HOME/Library/LaunchAgents"
    local LOGS_DIR="$HOME/Library/Logs"
    mkdir -p "$AGENTS_DIR"
    mkdir -p "$LOGS_DIR"

    # Get llama paths
    local LLAMA_DIR="$PLUGIN_DIR/llama.cpp"
    local LLAMA_BINARY=$(cat "$LLAMA_DIR/llama_path" 2>/dev/null || echo "")
    local MODEL_PATH=$(cat "$LLAMA_DIR/model_path" 2>/dev/null || echo "")

    if [ -z "$LLAMA_BINARY" ] || [ ! -f "$LLAMA_BINARY" ]; then
        if command -v llama-server &> /dev/null; then
            LLAMA_BINARY=$(which llama-server)
        else
            log_error "llama-server not found"
            exit 1
        fi
    fi

    # Create llama-server plist
    log_info "Creating llama-server launchd service..."
    cat > "$AGENTS_DIR/${LLAMA_SERVER_LABEL}.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LLAMA_SERVER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${LLAMA_BINARY}</string>
        <string>--hf-repo</string>
        <string>${LLAMA_SERVER_REPO}</string>
        <string>--hf-file</string>
        <string>${LLAMA_SERVER_MODEL}</string>
        <string>--embedding</string>
        <string>--port</string>
        <string>${LLAMA_SERVER_PORT}</string>
        <string>--ctx-size</string>
        <string>8192</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PLUGIN_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOGS_DIR}/llama-server.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGS_DIR}/llama-server.log</string>
    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
EOF

    # Create Qdrant plist
    log_info "Creating Qdrant launchd service..."
    local QDRANT_PATH=$(cat "$PLUGIN_DIR/qdrant/qdrant_path" 2>/dev/null || echo "$PLUGIN_DIR/qdrant/qdrant")
    local CONFIG_PATH=$(cat "$PLUGIN_DIR/qdrant/config_path" 2>/dev/null || echo "$PLUGIN_DIR/qdrant/config.yaml")

    cat > "$AGENTS_DIR/${QDRANT_LABEL}.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${QDRANT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${QDRANT_PATH}</string>
        <string>--config-path</string>
        <string>${CONFIG_PATH}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PLUGIN_DIR}/qdrant</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOGS_DIR}/qdrant.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGS_DIR}/qdrant.log</string>
    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>4096</integer>
    </dict>
</dict>
</plist>
EOF

    # Load services
    log_info "Loading services..."
    launchctl unload "$AGENTS_DIR/${LLAMA_SERVER_LABEL}.plist" 2>/dev/null || true
    launchctl unload "$AGENTS_DIR/${QDRANT_LABEL}.plist" 2>/dev/null || true
    launchctl load "$AGENTS_DIR/${LLAMA_SERVER_LABEL}.plist"
    launchctl load "$AGENTS_DIR/${QDRANT_LABEL}.plist"

    log_success "launchd services created and loaded"
}

# Setup Linux systemd services
setup_systemd_services() {
    log_info "Setting up Linux systemd services..."

    local SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"

    # Get llama paths
    local LLAMA_DIR="$PLUGIN_DIR/llama.cpp"
    local LLAMA_BINARY=$(cat "$LLAMA_DIR/llama_path" 2>/dev/null || echo "")

    if [ -z "$LLAMA_BINARY" ] || [ ! -f "$LLAMA_BINARY" ]; then
        if command -v llama-server &> /dev/null; then
            LLAMA_BINARY=$(which llama-server)
        else
            log_error "llama-server not found"
            exit 1
        fi
    fi

    # Create llama-server service
    log_info "Creating llama-server systemd service..."
    cat > "$SYSTEMD_DIR/llama-server.service" << EOF
[Unit]
Description=Llama.cpp Embedding Server for OpenClaw Memory
After=network.target

[Service]
Type=simple
ExecStart=${LLAMA_BINARY} --hf-repo ${LLAMA_SERVER_REPO} --embedding --port ${LLAMA_SERVER_PORT} --ctx-size 8192
WorkingDirectory=${PLUGIN_DIR}
Restart=on-failure
RestartSec=5
StandardOutput=append:$HOME/.local/log/llama-server.log
StandardError=append:$HOME/.local/log/llama-server.log
LimitNOFILE=4096

[Install]
WantedBy=default.target
EOF

    # Create Qdrant service
    log_info "Creating Qdrant systemd service..."
    local QDRANT_PATH=$(cat "$PLUGIN_DIR/qdrant/qdrant_path" 2>/dev/null || echo "$PLUGIN_DIR/qdrant/qdrant")
    local CONFIG_PATH=$(cat "$PLUGIN_DIR/qdrant/config_path" 2>/dev/null || echo "$PLUGIN_DIR/qdrant/config.yaml")

    cat > "$SYSTEMD_DIR/qdrant.service" << EOF
[Unit]
Description=Qdrant Vector Database for OpenClaw Memory
After=network.target

[Service]
Type=simple
ExecStart=${QDRANT_PATH} -c ${CONFIG_PATH}
WorkingDirectory=${PLUGIN_DIR}/qdrant
Restart=on-failure
RestartSec=5
StandardOutput=append:$HOME/.local/log/qdrant.log
StandardError=append:$HOME/.local/log/qdrant.log
LimitNOFILE=4096

[Install]
WantedBy=default.target
EOF

    # Enable and start services
    log_info "Enabling services..."
    mkdir -p "$HOME/.local/log"
    systemctl --user daemon-reload
    systemctl --user enable llama-server.service
    systemctl --user enable qdrant.service
    systemctl --user start llama-server.service
    systemctl --user start qdrant.service

    log_success "systemd services created and enabled"
}

# Setup OpenClaw configuration
setup_openclaw_config() {
    log_info "Setting up OpenClaw configuration..."

    local CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

    if [ ! -f "$CONFIG_FILE" ]; then
        log_warn "OpenClaw config not found. Creating basic config..."
        cat > "$CONFIG_FILE" << EOF
{
  "plugins": {
    "slots": {
      "memory": "${PLUGIN_NAME}"
    },
    "entries": {
      "${PLUGIN_NAME}": {
        "enabled": true
      }
    },
    "configs": {
      "${PLUGIN_NAME}": {
        "backend": "qdrant",
        "qdrant": {
          "url": "http://localhost:${QDRANT_PORT}"
        },
        "embedding": {
          "endpoint": "http://localhost:${LLAMA_SERVER_PORT}"
        }
      }
    }
  }
}
EOF
        log_success "OpenClaw config created"
    else
        # Add plugin config if not exists
        if ! grep -q "\"${PLUGIN_NAME}\"" "$CONFIG_FILE"; then
            log_info "Adding plugin config to existing OpenClaw config..."
            # Use node to properly merge JSON
            node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
if (!config.plugins) config.plugins = {};
if (!config.plugins.configs) config.plugins.configs = {};
config.plugins.configs['${PLUGIN_NAME}'] = {
  backend: 'qdrant',
  qdrant: { url: 'http://localhost:${QDRANT_PORT}' },
  embedding: { endpoint: 'http://localhost:${LLAMA_SERVER_PORT}' }
};
if (!config.plugins.slots) config.plugins.slots = {};
config.plugins.slots.memory = '${PLUGIN_NAME}';
if (!config.plugins.entries) config.plugins.entries = {};
config.plugins.entries['${PLUGIN_NAME}'] = { enabled: true };
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2) + '\n');
console.log('Config updated');
"
            log_success "OpenClaw config updated"
        else
            log_success "OpenClaw config already has plugin configuration"
        fi
    fi
}

# Start services
start_services() {
    log_info "Starting services..."

    if [ "$INIT_SYSTEM" = "launchd" ]; then
        launchctl kickstart -k gui/$(id -u)/"$LLAMA_SERVER_LABEL" 2>/dev/null || true
        launchctl kickstart -k gui/$(id -u)/"$QDRANT_LABEL" 2>/dev/null || true
        launchctl list | grep -q "$LLAMA_SERVER_LABEL" && log_success "llama-server started" || log_warn "llama-server start failed"
        launchctl list | grep -q "$QDRANT_LABEL" && log_success "Qdrant started" || log_warn "Qdrant start failed"
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user start llama-server.service
        systemctl --user start qdrant.service
        systemctl --user status llama-server.service --no-pager | grep -q "active" && log_success "llama-server started" || log_warn "llama-server start failed"
        systemctl --user status qdrant.service --no-pager | grep -q "active" && log_success "Qdrant started" || log_warn "Qdrant start failed"
    fi

    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 3

    # Health checks
    if curl -s http://localhost:$LLAMA_SERVER_PORT/health > /dev/null 2>&1; then
        log_success "llama-server health check passed"
    else
        log_warn "llama-server health check failed (may need more time)"
    fi

    if curl -s http://localhost:$QDRANT_PORT/health > /dev/null 2>&1; then
        log_success "Qdrant health check passed"
    else
        log_warn "Qdrant health check failed (may need more time)"
    fi
}

# Stop services
stop_services() {
    log_info "Stopping services..."

    if [ "$INIT_SYSTEM" = "launchd" ]; then
        launchctl bootout gui/$(id -u)/"$LLAMA_SERVER_LABEL" 2>/dev/null || true
        launchctl bootout gui/$(id -u)/"$QDRANT_LABEL" 2>/dev/null || true
        log_success "Services stopped"
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user stop llama-server.service
        systemctl --user stop qdrant.service
        log_success "Services stopped"
    fi
}

# Show service status
show_status() {
    echo ""
    echo "=== OpenClaw Memory Services Status ==="
    echo ""

    if [ "$INIT_SYSTEM" = "launchd" ]; then
        echo "llama-server (port $LLAMA_SERVER_PORT):"
        if launchctl list | grep -q "$LLAMA_SERVER_LABEL"; then
            echo -e "  ${GREEN}✓ Running${NC}"
        else
            echo -e "  ${RED}✗ Not running${NC}"
        fi
        curl -s http://localhost:$LLAMA_SERVER_PORT/health > /dev/null 2>&1 && echo -e "  ${GREEN}✓ Healthy${NC}" || echo -e "  ${YELLOW}○ Health check pending${NC}"
        echo ""

        echo "Qdrant (port $QDRANT_PORT):"
        if launchctl list | grep -q "$QDRANT_LABEL"; then
            echo -e "  ${GREEN}✓ Running${NC}"
        else
            echo -e "  ${RED}✗ Not running${NC}"
        fi
        curl -s http://localhost:$QDRANT_PORT/health > /dev/null 2>&1 && echo -e "  ${GREEN}✓ Healthy${NC}" || echo -e "  ${YELLOW}○ Health check pending${NC}"
        echo ""
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        echo "llama-server (port $LLAMA_SERVER_PORT):"
        if systemctl --user is-active llama-server.service > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓ Active${NC}"
        else
            echo -e "  ${RED}✗ Inactive${NC}"
        fi
        curl -s http://localhost:$LLAMA_SERVER_PORT/health > /dev/null 2>&1 && echo -e "  ${GREEN}✓ Healthy${NC}" || echo -e "  ${YELLOW}○ Health check pending${NC}"
        echo ""

        echo "Qdrant (port $QDRANT_PORT):"
        if systemctl --user is-active qdrant.service > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓ Active${NC}"
        else
            echo -e "  ${RED}✗ Inactive${NC}"
        fi
        curl -s http://localhost:$QDRANT_PORT/health > /dev/null 2>&1 && echo -e "  ${GREEN}✓ Healthy${NC}" || echo -e "  ${YELLOW}○ Health check pending${NC}"
        echo ""
    fi

    # Memory plugin status
    echo "OpenClaw Memory Plugin:"
    if [ -d "$PLUGIN_DIR" ]; then
        echo -e "  ${GREEN}✓ Installed${NC} at $PLUGIN_DIR"
    else
        echo -e "  ${RED}✗ Not installed${NC}"
    fi
}

# Show logs
show_logs() {
    local target=$1
    local llama_log="$HOME/Library/Logs/llama-server.log"
    local qdrant_log="$HOME/Library/Logs/qdrant.log"

    if [ "$OS" = "linux" ]; then
        llama_log="$HOME/.local/log/llama-server.log"
        qdrant_log="$HOME/.local/log/qdrant.log"
    fi

    case "$target" in
        llama)
            echo "=== llama-server Log ==="
            tail -f "$llama_log"
            ;;
        qdrant)
            echo "=== Qdrant Log ==="
            tail -f "$qdrant_log"
            ;;
        *)
            echo "=== Both Logs (llama-server | qdrant) ==="
            tail -f "$llama_log" "$qdrant_log" 2>/dev/null | grep --line-buffered -v "^==>"
            ;;
    esac
}

# Uninstall everything
uninstall() {
    log_warn "This will remove all services and downloaded files"
    echo ""
    read -p "Are you sure? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Cancelled"
        exit 0
    fi

    log_info "Stopping services..."
    stop_services

    log_info "Removing services..."
    if [ "$INIT_SYSTEM" = "launchd" ]; then
        rm -f "$HOME/Library/LaunchAgents/${LLAMA_SERVER_LABEL}.plist"
        rm -f "$HOME/Library/LaunchAgents/${QDRANT_LABEL}.plist"
        launchctl list | grep -q "$LLAMA_SERVER_LABEL" && launchctl bootout gui/$(id -u)/"$LLAMA_SERVER_LABEL" 2>/dev/null || true
        launchctl list | grep -q "$QDRANT_LABEL" && launchctl bootout gui/$(id -u)/"$QDRANT_LABEL" 2>/dev/null || true
    elif [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl --user disable llama-server.service 2>/dev/null || true
        systemctl --user disable qdrant.service 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/llama-server.service"
        rm -f "$HOME/.config/systemd/user/qdrant.service"
        systemctl --user daemon-reload
    fi

    log_info "Removing downloaded files..."
    rm -rf "$PLUGIN_DIR/llama.cpp"
    rm -rf "$PLUGIN_DIR/qdrant"

    log_info "Removing plugin configuration from OpenClaw..."
    local CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"
    if [ -f "$CONFIG_FILE" ]; then
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
if (config.plugins && config.plugins.configs) delete config.plugins.configs['${PLUGIN_NAME}'];
if (config.plugins && config.plugins.slots && config.plugins.slots.memory === '${PLUGIN_NAME}') delete config.plugins.slots.memory;
if (config.plugins && config.plugins.entries) delete config.plugins.entries['${PLUGIN_NAME}'];
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2) + '\n');
"
    fi

    log_success "Uninstall complete!"
    log_info "Note: OpenClaw directory ($OPENCLAW_DIR) and plugin source code are preserved"
}

# Print usage
usage() {
    cat << EOF
OpenClaw Memory Plugin - Deployment Script

Usage: $0 <command>

Commands:
  install    - Install and setup everything (default)
  uninstall  - Remove all services and downloaded files
  status     - Check service status
  start      - Start all services
  stop       - Stop all services
  restart    - Restart all services
  logs       - View logs (llama|qdrant|all)
  help       - Show this help

Examples:
  $0 install           # Full installation
  $0 status            # Check if services are running
  $0 logs llama        # View only llama-server logs
  $0 uninstall         # Remove everything

EOF
}

# Main
main() {
    detect_os
    check_dependencies

    case "${1:-install}" in
        install)
            log_info "=== Installing OpenClaw Memory Plugin ==="
            echo ""

            setup_llama_cpp
            echo ""

            setup_qdrant
            echo ""

            if [ "$INIT_SYSTEM" = "launchd" ]; then
                setup_launchd_services
            elif [ "$INIT_SYSTEM" = "systemd" ]; then
                setup_systemd_services
            fi
            echo ""

            setup_openclaw_config
            echo ""

            start_services
            echo ""

            show_status
            echo ""

            log_success "=== Installation Complete ==="
            echo ""
            echo "Services will auto-start on boot"
            echo "To view logs: $0 logs"
            echo "To check status: $0 status"
            ;;

        uninstall)
            uninstall
            ;;

        status)
            show_status
            ;;

        start)
            start_services
            ;;

        stop)
            stop_services
            ;;

        restart)
            stop_services
            sleep 2
            start_services
            ;;

        logs)
            show_logs "${2:-all}"
            ;;

        help|--help|-h)
            usage
            ;;

        *)
            log_error "Unknown command: $1"
            usage
            exit 1
            ;;
    esac
}

main "$@"
