#!/usr/bin/env python3
"""
OpenClaw Memory Plugin - 测试脚本

用法:
    python3 test_memory.py

测试记忆系统的存储和检索功能。
"""

import sys
import json
import requests

BASE_URL = "http://localhost:8082"

def test_health():
    """测试健康检查"""
    print("测试：健康检查...", end=" ")
    resp = requests.get(f"{BASE_URL}/health")
    data = resp.json()
    if data.get("status") == "healthy":
        print("通过")
        return True
    else:
        print(f"失败：{data}")
        return False

def test_store(session_id, content, importance=0.6):
    """测试存储记忆"""
    print(f"测试：存储记忆 '{content[:20]}...'...", end=" ")
    resp = requests.post(
        f"{BASE_URL}/memory/store",
        json={"session_id": session_id, "content": content, "importance": importance}
    )
    data = resp.json()
    if data.get("status") == "ok":
        print("通过")
        return True
    else:
        print(f"失败：{data}")
        return False

def test_search(query, threshold=0.5):
    """测试搜索记忆"""
    print(f"测试：搜索 '{query[:20]}...'...", end=" ")
    resp = requests.post(
        f"{BASE_URL}/memory/search",
        json={"query": query, "top_k": 5, "threshold": threshold}
    )
    data = resp.json()
    if "memories" in data:
        print(f"通过 (找到 {data.get('count', 0)} 条结果)")
        for mem in data.get("memories", []):
            print(f"  - [{mem['type']}] {mem['content'][:40]}... (相似度：{mem['similarity']:.3f})")
        return True
    else:
        print(f"失败：{data}")
        return False

def test_stats():
    """测试统计信息"""
    print("测试：获取统计...", end=" ")
    resp = requests.get(f"{BASE_URL}/memory/stats")
    data = resp.json()
    print(f"通过")
    print(f"  统计：{json.dumps(data, indent=2)}")
    return True

def run_tests():
    """运行所有测试"""
    print("=" * 50)
    print("OpenClaw Memory Plugin 测试")
    print("=" * 50)

    tests = [
        ("健康检查", lambda: test_health()),
        ("存储记忆 1", lambda: test_store("test-1", "用户想学习 Rust 编程语言", 0.7)),
        ("存储记忆 2", lambda: test_store("test-1", "用户喜欢 Python 的装饰器", 0.6)),
        ("搜索 Rust", lambda: test_search("用户想学什么语言")),
        ("搜索 Python", lambda: test_search("Python 相关")),
        ("统计信息", lambda: test_stats()),
    ]

    passed = 0
    failed = 0

    for name, test_fn in tests:
        try:
            if test_fn():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"异常：{e}")
            failed += 1

    print("=" * 50)
    print(f"测试结果：{passed} 通过，{failed} 失败")
    print("=" * 50)

    return failed == 0

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
