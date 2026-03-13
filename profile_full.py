#!/usr/bin/env python3
"""完整链路性能分析 - 模拟 OpenClaw 调用记忆系统的完整流程"""

import time
import sys
import os

# 测试路径
paths = [
    '/Users/liufei/.openclaw/extensions/openclaw-memory',
    '/Users/liufei/.openclaw/plugins/openclaw-memory'
]

for test_path in paths:
    if not os.path.exists(test_path):
        continue
        
    print(f"\n{'='*60}")
    print(f"测试路径：{test_path}")
    print(f"{'='*60}")
    
    sys.path.insert(0, test_path)
    
    # 重新导入模块 (避免缓存)
    import importlib
    modules_to_reload = ['database', 'embedding_model', 'vector_store', 
                         'episodic_memory', 'semantic_memory', 'reflection_memory',
                         'retrieval_pipeline', 'context_builder', 'memory_manager', 'plugin']
    
    for mod_name in modules_to_reload:
        if mod_name in sys.modules:
            del sys.modules[mod_name]
    
    from database import Database
    from memory_manager import MemoryManager
    from plugin import OpenClawMemoryPlugin
    
    DB_CONFIG = {
        'host': 'localhost',
        'port': 5432,
        'database': 'openclaw_memory',
        'user': 'liufei',
        'password': ''
    }
    
    query = "用户想学什么编程语言"
    
    # 场景 1: 每次请求都创建新实例 (最差情况)
    print("\n[场景 1] 每次请求创建新实例:")
    start = time.time() * 1000
    db = Database(DB_CONFIG)
    mm = MemoryManager(db)
    memories = mm.retrieve_relevant(query, top_k=10, threshold=0.6)
    context = mm.build_context("test-session", memories, "User said hello")
    total = time.time() * 1000 - start
    print(f"  总耗时：{total:.2f}ms")
    print(f"  返回记忆数：{len(memories)}")
    db.close()
    
    # 场景 2: 复用 MemoryManager (服务器模式)
    print("\n[场景 2] 复用 MemoryManager:")
    db = Database(DB_CONFIG)
    mm = MemoryManager(db)
    
    # 模拟 3 次连续请求
    for i in range(3):
        start = time.time() * 1000
        memories = mm.retrieve_relevant(query, top_k=10, threshold=0.6)
        context = mm.build_context("test-session", memories)
        elapsed = time.time() * 1000 - start
        print(f"  请求 {i+1}: {elapsed:.2f}ms")
    
    db.close()
    
    # 从路径中移除
    sys.path.remove(test_path)
    
    print()

