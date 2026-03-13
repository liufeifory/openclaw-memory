#!/bin/bash
# Start Qdrant for OpenClaw Memory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QDRANT_VERSION="1.12.4"
QDRANT_DIR="$SCRIPT_DIR/qdrant"
QDRANT_BINARY="$QDRANT_DIR/qdrant"
CONFIG_FILE="$QDRANT_DIR/config.yaml"
STORAGE_DIR="$QDRANT_DIR/storage"

# Detect platform
PLATFORM=""
case "$(uname -s)" in
  Darwin*)
    PLATFORM="x86_64-apple-darwin"
    if [[ "$(uname -m)" == "arm64" ]]; then
      PLATFORM="aarch64-apple-darwin"
    fi
    ;;
  Linux*)
    PLATFORM="x86_64-unknown-linux-gnu"
    ;;
  MINGW*|CYGWIN*)
    PLATFORM="x86_64-pc-windows-msvc"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)"
    exit 1
    ;;
esac

echo "=== OpenClaw Memory - Qdrant Setup ==="
echo "Platform: $PLATFORM"
echo ""

# Create directory
mkdir -p "$QDRANT_DIR"
mkdir -p "$STORAGE_DIR"

# Download if not exists
if [ ! -f "$QDRANT_BINARY" ]; then
  echo "Downloading Qdrant $QDRANT_VERSION..."
  DOWNLOAD_URL="https://github.com/qdrant/qdrant/releases/download/v$QDRANT_VERSION/qdrant-$PLATFORM.tar.gz"

  if command -v curl &> /dev/null; then
    curl -L -o "$QDRANT_DIR/qdrant.tar.gz" "$DOWNLOAD_URL"
  elif command -v wget &> /dev/null; then
    wget -O "$QDRANT_DIR/qdrant.tar.gz" "$DOWNLOAD_URL"
  else
    echo "Error: curl or wget required"
    exit 1
  fi

  echo "Extracting..."
  tar -xzf "$QDRANT_DIR/qdrant.tar.gz" -C "$QDRANT_DIR"
  rm "$QDRANT_DIR/qdrant.tar.gz"

  echo "Qdrant downloaded to: $QDRANT_BINARY"
fi

# Create config if not exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Creating config file..."
  cat > "$CONFIG_FILE" << EOF
storage:
  storage_path: $STORAGE_DIR

service:
  host: 127.0.0.1
  http_port: 6333

log_level: INFO
EOF
fi

# Start Qdrant
echo "Starting Qdrant..."
echo "Storage: $STORAGE_DIR"
echo "API: http://localhost:6333"
echo ""
echo "Press Ctrl+C to stop"
echo ""

cd "$QDRANT_DIR"
exec "$QDRANT_BINARY"
