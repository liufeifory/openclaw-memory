"""Database connection and query handling for PostgreSQL with pgvector."""

import logging
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


class Database:
    """Handles PostgreSQL database connections and queries.

    Supports pgvector for vector similarity search.

    Attributes:
        conn: PostgreSQL connection object.
    """

    def __init__(self, config: Dict[str, Any]) -> None:
        """Initialize database connection.

        Args:
            config: Database configuration dict with keys:
                - host: Database host
                - port: Database port
                - database: Database name
                - user: Database user
                - password: Database password
        """
        try:
            self.conn = psycopg2.connect(**config)
            logger.info(f"Connected to PostgreSQL database: {config.get('database')}")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            raise

    def query(self, sql: str, params: Optional[Tuple] = None) -> List[Dict[str, Any]]:
        """Execute a SELECT query and return results.

        Args:
            sql: SQL query string with %s placeholders.
            params: Query parameters tuple.

        Returns:
            List of dicts representing rows.
        """
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Query failed: {e}")
            raise

    def execute(self, sql: str, params: Optional[Tuple] = None) -> None:
        """Execute an INSERT/UPDATE/DELETE query.

        Args:
            sql: SQL query string with %s placeholders.
            params: Query parameters tuple.
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
            self.conn.commit()
        except Exception as e:
            logger.error(f"Execute failed: {e}")
            self.conn.rollback()
            raise

    def execute_many(self, sql: str, params_list: List[Tuple]) -> None:
        """Execute a query with multiple parameter sets.

        Args:
            sql: SQL query string with %s placeholders.
            params_list: List of parameter tuples.
        """
        try:
            with self.conn.cursor() as cur:
                cur.executemany(sql, params_list)
            self.conn.commit()
        except Exception as e:
            logger.error(f"Execute many failed: {e}")
            self.conn.rollback()
            raise

    def close(self) -> None:
        """Close database connection."""
        try:
            self.conn.close()
            logger.info("Database connection closed")
        except Exception as e:
            logger.error(f"Error closing connection: {e}")

    def __del__(self) -> None:
        """Cleanup on destruction."""
        try:
            self.close()
        except Exception:
            pass
