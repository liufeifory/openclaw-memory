#!/usr/bin/env python3
"""
Memory Server - HTTP API for OpenClaw Memory Plugin

Run this service to enable semantic memory search for OpenClaw.

Usage:
    python3 memory_server.py [--port 8080]

Configuration:
    Set environment variables or edit defaults:
    - MEMORY_DB_HOST: PostgreSQL host (default: localhost)
    - MEMORY_DB_PORT: PostgreSQL port (default: 5432)
    - MEMORY_DB_NAME: Database name (default: openclaw)
    - MEMORY_DB_USER: Database user (default: postgres)
    - MEMORY_DB_PASS: Database password (required)
"""

import os
import sys
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import Database
from memory_manager import MemoryManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration from environment
DB_CONFIG = {
    "host": os.getenv("MEMORY_DB_HOST", "localhost"),
    "port": int(os.getenv("MEMORY_DB_PORT", 5432)),
    "database": os.getenv("MEMORY_DB_NAME", "openclaw_memory"),
    "user": os.getenv("MEMORY_DB_USER", "liufei"),
    "password": os.getenv("MEMORY_DB_PASS", "")
}

app = Flask(__name__)
CORS(app)  # Enable CORS for local development

# Initialize memory manager (lazy loading)
_memory_manager = None


def get_memory_manager():
    """Get or create memory manager instance."""
    global _memory_manager
    if _memory_manager is None:
        try:
            db = Database(DB_CONFIG)
            _memory_manager = MemoryManager(db)
            logger.info("Memory manager initialized")
        except Exception as e:
            logger.error(f"Failed to initialize memory manager: {e}")
            raise
    return _memory_manager


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    try:
        mm = get_memory_manager()
        return jsonify({
            "status": "healthy",
            "service": "openclaw-memory"
        })
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "error": str(e)
        }), 500


@app.route("/memory/search", methods=["POST"])
def search_memory():
    """
    Search memories by semantic similarity.

    Request JSON:
        - query (str): Search query text
        - top_k (int, optional): Number of results (default: 10)
        - threshold (float, optional): Similarity threshold (default: 0.6)

    Response JSON:
        - memories: List of memory objects with:
            - type: "episodic" | "semantic" | "reflection"
            - content: Memory text
            - importance: Importance score
            - similarity: Similarity score
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        query = data.get("query")
        if not query:
            return jsonify({"error": "Missing 'query' field"}), 400

        top_k = data.get("top_k", 10)
        threshold = data.get("threshold", 0.6)

        mm = get_memory_manager()
        memories = mm.retrieve_relevant(query, top_k=top_k, threshold=threshold)

        return jsonify({
            "query": query,
            "count": len(memories),
            "memories": memories
        })

    except Exception as e:
        logger.error(f"Search failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/memory/store", methods=["POST"])
def store_memory():
    """
    Store a new memory.

    Request JSON:
        - session_id (str): Session identifier
        - content (str): Memory content
        - importance (float, optional): Base importance (default: 0.5)

    Response JSON:
        - status: "ok"
        - memory_id: ID of stored memory
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        session_id = data.get("session_id")
        content = data.get("content")

        if not session_id or not content:
            return jsonify({
                "error": "Missing 'session_id' or 'content' field"
            }), 400

        importance = data.get("importance", 0.5)

        mm = get_memory_manager()
        mm.async_store(session_id, content, importance)

        return jsonify({
            "status": "ok",
            "message": "Memory queued for storage"
        })

    except Exception as e:
        logger.error(f"Store failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/memory/stats", methods=["GET"])
def get_stats():
    """Get memory system statistics."""
    try:
        mm = get_memory_manager()
        # Get stats from database directly
        stats = {
            "episodic_count": mm.db.query("SELECT COUNT(*) as count FROM episodic_memory")[0]["count"],
            "semantic_count": mm.db.query("SELECT COUNT(*) as count FROM semantic_memory")[0]["count"],
            "reflection_count": mm.db.query("SELECT COUNT(*) as count FROM reflection_memory")[0]["count"],
            "embedding_count": mm.db.query("SELECT COUNT(*) as count FROM memory_embeddings")[0]["count"]
        }
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/memory/maintenance", methods=["POST"])
def run_maintenance():
    """Run memory maintenance operations."""
    try:
        mm = get_memory_manager()
        results = mm.run_maintenance()
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Shutdown the server gracefully."""
    try:
        mm = get_memory_manager()
        mm.shutdown()
        logger.info("Server shutting down")
        return jsonify({"status": "shutting down"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="OpenClaw Memory Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    args = parser.parse_args()

    logger.info(f"Starting memory server on {args.host}:{args.port}")

    try:
        # Pre-initialize memory manager
        get_memory_manager()
        app.run(host=args.host, port=args.port, debug=args.debug)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    finally:
        if _memory_manager:
            _memory_manager.shutdown()
