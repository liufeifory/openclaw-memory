CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE episodic_memory (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP,
    last_accessed TIMESTAMP
);

CREATE TABLE semantic_memory (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    importance FLOAT,
    access_count INT DEFAULT 0,
    created_at TIMESTAMP
);

CREATE TABLE reflection_memory (
    id BIGSERIAL PRIMARY KEY,
    summary TEXT,
    importance FLOAT,
    created_at TIMESTAMP
);

CREATE TABLE memory_embeddings (
    memory_id BIGINT,
    memory_type TEXT,
    embedding vector(1024),
    created_at TIMESTAMP
);

CREATE INDEX idx_memory_embedding
ON memory_embeddings
USING hnsw (embedding vector_cosine_ops);

