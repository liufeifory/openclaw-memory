# 文档导入功能

## 功能概述

支持 PDF、Word、Markdown 文档导入，自动分段存储到记忆系统。

## 配置

在 OpenClaw 配置文件中添加：

```json
{
  "documentImport": {
    "watchDir": "~/.openclaw/documents",
    "chunkSize": 500,
    "chunkOverlap": 50
  }
}
```

### 配置项说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `watchDir` | 监控的目录路径，放入该目录的文档会自动导入 | 无 |
| `chunkSize` | 每个文本块的目标字符数 | 500 |
| `chunkOverlap` | 块之间的重叠字符数 | 50 |

## 智能语义分段

系统使用**智能语义分段**技术，而非简单的固定大小切分：

1. **段落边界** - 优先保持文档原有结构
2. **句子边界** - 避免在句子中间切断
3. **语义相似性** - 使用关键词重叠检测主题变化，将相关内容分组

### 分段策略

```
内容 → 提取段落 → 语义分组 → 句子切分 → 合并小组块 → 最终输出
```

这种策略确保：
- 每个块在语义上是连贯的
- 主题变化处会自然分段
- 不会切断完整的句子

## 使用方式

### 1. 目录监控模式

将 PDF/Word/Markdown 文件放入配置的监控目录，系统会自动：
- 检测新文件
- 解析文档内容
- 按段落切分成块
- 存储到记忆系统

支持的文件格式：
- `.pdf` - PDF 文档
- `.docx` - Word 文档
- `.md` / `.markdown` - Markdown 文档

### 2. API 导入

使用 `document_import` tool 导入文档：

**从 URL 导入：**
```json
{
  "tool": "document_import",
  "arguments": {
    "url": "https://example.com/article"
  }
}
```

**从本地文件导入：**
```json
{
  "tool": "document_import",
  "arguments": {
    "path": "/path/to/document.pdf"
  }
}
```

### 3. 批量导入脚本

使用 `import-documents.js` 脚本批量导入当前文档目录中的所有文件：

```bash
cd ~/.openclaw/plugins/openclaw-memory
npm run import:docs
# 或者
node scripts/import-documents.js
```

脚本会：
1. 扫描 `~/.openclaw/documents` 目录
2. 自动解析所有支持的文档格式
3. 使用配置的 `chunkSize` 和 `chunkOverlap` 进行分段
4. 将每个片段存储到记忆系统
5. 显示导入统计信息

## 支持的格式

| 格式 | 扩展名 | 说明 |
|------|--------|------|
| PDF | `.pdf` | 使用 pdf-parse 解析 |
| Word | `.docx` | 使用 mammoth 解析 |
| Markdown | `.md`, `.markdown` | 直接读取文本 |
| HTML | URL | 从网页提取文本内容 |

## 技术实现

### 组件架构

```
┌─────────────────┐     ┌──────────────────┐
│ DocumentParser  │ ──► │ DocumentSplitter │
└─────────────────┘     └──────────────────┘
         │                       │
         ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│  URL Importer   │     │ DocumentWatcher  │
└─────────────────┘     └──────────────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │  MemoryManager   │
                      └──────────────────┘
```

### 核心模块

- **DocumentParser** (`src/document-parser.ts`): 解析 PDF、Word、Markdown、HTML 格式
- **DocumentSplitter** (`src/document-splitter.ts`): 智能语义分段，按段落/句子/语义相似性切分
- **DocumentWatcher** (`src/document-watcher.ts`): 监控目录变化
- **UrlImporter** (`src/url-importer.ts`): 从 URL 导入内容

## 注意事项

1. **加密 PDF**: 加密的 PDF 文件无法解析，会记录错误日志
2. **大文件**: 建议文件大小不超过 10MB，避免内存问题
3. **URL 超时**: 网络请求超时时间为 30 秒
4. **重复导入**: 同一文件再次放入监控目录会重新处理

## 故障排查

### 文档未自动导入

检查：
1. 监控目录配置是否正确
2. 文件扩展名是否支持
3. 查看日志是否有解析错误

```bash
# 查看记忆插件日志
tail -f ~/.openclaw/logs/gateway.log | grep -i document
```

### 解析失败

查看控制台日志，常见错误：
- `Failed to parse PDF`: PDF 损坏或加密
- `Unsupported file type`: 文件格式不支持

### 批量导入失败

```bash
# 手动运行导入脚本
cd ~/.openclaw/plugins/openclaw-memory
node scripts/import-documents.js

# 检查 openclaw.json 配置
cat ~/.openclaw/openclaw.json | python3 -m json.tool
```
