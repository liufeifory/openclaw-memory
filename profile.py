#!/usr/bin/env python3
"""性能分析脚本 - 分析记忆检索各环节耗时"""

import time
import requests
from database import Database

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "openclaw_memory",
    "user": "liufei",
    "password": ""
}

def test_embedding(text):
    start = time.time()
    response = requests.post(
        "http://127.0.0.1:8080/embedding",
        json={"input": text},
        headers={"Content-Type": "application/json"}
    )
    result = response.json()
    elapsed = (time.time() - start) * 1000
    print(f"[Embedding 生成] 耗时：{elapsed:.2f}ms")

    # 处理嵌套数组格式
    if isinstance(result, list):
        emb = result[0]["embedding"]
        if isinstance(emb, list) and isinstance(emb[0], list):
            return emb[0]  # 解包嵌套数组
        return emb
    emb = result["embedding"]
    if isinstance(emb, list) and isinstance(emb[0], list):
        return emb[0]
    return emb

def test_full_search(query):
    """测试完整的 memory_server search API"""
    start = time.time()
    response = requests.post(
        "http://127.0.0.1:8082/memory/search",
        json={"query": query, "top_k": 5, "threshold": 0.6},
        headers={"Content-Type": "application/json"}
    )
    elapsed = (time.time() - start) * 1000
    result = response.json()
    print(f"[完整 Search API] 耗时：{elapsed:.2f}ms, 返回 {len(result.get('memories', []))} 条结果")
    return elapsed, result

def test_vector_search(emb):
    start = time.time()
    db = Database(DB_CONFIG)
    emb_str = ','.join(str(x) for x in emb)
    query = """
        SELECT m.id AS memory_id, e.memory_type, m.content, m.importance,
               1 - (e.embedding <=> %s::vector) AS similarity
        FROM memory_embeddings e
        JOIN episodic_memory m ON e.memory_id = m.id
        ORDER BY e.embedding <=> %s::vector
        LIMIT %s
    """
    results = db.query(query, (f'[{emb_str}]', f'[{emb_str}]', 10))
    db.close()
    elapsed = (time.time() - start) * 1000
    print(f"[PostgreSQL 向量搜索] 耗时：{elapsed:.2f}ms, 找到 {len(results)} 条结果")
    return results

def test_semantic_fetch():
    start = time.time()
    db = Database(DB_CONFIG)
    results = db.query("SELECT * FROM semantic_memory ORDER BY importance DESC LIMIT 20")
    db.close()
    elapsed = (time.time() - start) * 1000
    print(f"[语义记忆获取] 耗时：{elapsed:.2f}ms")
    return results

def test_reflection_fetch():
    start = time.time()
    db = Database(DB_CONFIG)
    results = db.query("SELECT * FROM reflection_memory ORDER BY importance DESC LIMIT 5")
    db.close()
    elapsed = (time.time() - start) * 1000
    print(f"[反思记忆获取] 耗时：{elapsed:.2f}ms")
    return results

def test_http_request():
    """测试 HTTP 请求开销"""
    start = time.time()
    response = requests.get("http://localhost:8082/health")
    elapsed = (time.time() - start) * 1000
    print(f"[HTTP 健康检查] 耗时：{elapsed:.2f}ms")
    return elapsed

def profile_search(query):
    print(f"\n{'='*50}")
    print(f"性能分析：搜索 '{query}'")
    print(f"{'='*50}\n")

    total_start = time.time()
    timings = {}

    # 1. Embedding 生成
    emb = test_embedding(query)
    timings["embedding"] = list(timings.values())[-1] if timings else 0

    # 2. 向量搜索
    results = test_vector_search(emb)
    timings["vector_search"] = list(timings.values())[-1] if len(timings.values()) > 1 else 0

    # 3. 语义记忆获取
    semantic = test_semantic_fetch()
    timings["semantic_fetch"] = list(timings.values())[-1]

    # 4. 反思记忆获取
    reflection = test_reflection_fetch()
    timings["reflection_fetch"] = list(timings.values())[-1]

    # HTTP 请求测试
    http_time = test_http_request()
    timings["http_overhead"] = http_time

    total_elapsed = (time.time() - total_start) * 1000

    print(f"\n{'='*50}")
    print(f"总耗时（端到端）: {total_elapsed:.2f}ms")
    print(f"{'='*50}")

    # 分析瓶颈
    print("\n瓶颈分析:")
    for name, time_ms in sorted(timings.items(), key=lambda x: x[1], reverse=True):
        pct = (time_ms / total_elapsed) * 100 if total_elapsed > 0 else 0
        print(f"  {name}: {time_ms:.2f}ms ({pct:.1f}%)")

    print(f"\n未计入开销：{total_elapsed - sum(timings.values()):.2f}ms")
    print("(可能包括：数据库连接创建、对象初始化、Python 代码执行等)")

    return timings

if __name__ == "__main__":
    query = "用户想学什么编程语言"

    print("\n### 测试完整 search API 调用 ###")
    full_time, _ = test_full_search(query)

    print("\n### 各环节分解测试 ###")
    profile_search(query)

    print(f"\n### 对比 ###")
    print(f"完整 API 调用：{full_time:.2f}ms")
    print(f"分解测试总和：~58ms")
    print(f"差异：{full_time - 58:.2f}ms")
