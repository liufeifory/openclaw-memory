-- ============================================================
-- OpenClaw Memory - Term Knowledge Graph Schema V2.0
-- ============================================================
--
-- 表结构：
-- 1. term - 术语实体表（带版本管理）
-- 2. term_relation - Graph Relation Table（使用 RELATE）
--
-- 核心改进：
-- - 使用 TYPE RELATION FROM term TO term
-- - method 字段记录关系发现来源
-- - confidence 表示关系可信度
-- - decay_factor 用于共现关系衰减
-- - version_range 支持版本演进
-- - is_primary + primary_id 支持主实体-别名合并
--
-- 创建日期：2026-04-11
-- 更新日期：2026-04-11 (V2.0)
-- ============================================================

-- ------------------------------------------------------------
-- 术语实体表（带版本管理）
-- ------------------------------------------------------------

DEFINE TABLE term SCHEMAFULL;

-- 基本信息
DEFINE FIELD name ON term TYPE string;              -- 原始术语
DEFINE FIELD normalized ON term TYPE string;        -- 标准化形式（小写）
DEFINE FIELD namespace ON term TYPE string;         -- 命名空间 domain.normalized[version]
DEFINE FIELD domain ON term TYPE string;            -- 所属领域

-- 分类信息
DEFINE FIELD type ON term TYPE string;              -- 类型（component/parameter/algorithm/tool/concept/protocol/api/metric/entity）
DEFINE FIELD aliases ON term TYPE array<string>;    -- 别名列表
DEFINE FIELD description ON term TYPE string;       -- 术语描述（用于嵌入增强）

-- 向量嵌入（name + description 组合）
DEFINE FIELD embedding ON term TYPE array<float>;   -- 向量嵌入

-- 统计信息
DEFINE FIELD frequency ON term TYPE int;            -- 出现频次
DEFINE FIELD confidence ON term TYPE float;         -- 置信度（0.0 ~ 1.0）

-- 来源追踪
DEFINE FIELD source_docs ON term TYPE array<string>;-- 来源文档列表

-- 版本管理（新增）
DEFINE FIELD version_range ON term TYPE string DEFAULT '';  -- 版本范围（如 "12-17"）
DEFINE FIELD is_primary ON term TYPE bool DEFAULT true;     -- 是否为主实体
DEFINE FIELD primary_id ON term TYPE string DEFAULT '';     -- 主实体ID（别名指向）

-- 时间戳
DEFINE FIELD created_at ON term TYPE datetime;      -- 创建时间
DEFINE FIELD updated_at ON term TYPE datetime;      -- 更新时间

-- ------------------------------------------------------------
-- 术语表索引
-- ------------------------------------------------------------

-- 唯一索引：标准化术语（防止重复）
DEFINE INDEX term_normalized_idx ON term UNIQUE COLUMNS normalized;

-- 唯一索引：命名空间
DEFINE INDEX term_namespace_idx ON term UNIQUE COLUMNS namespace;

-- 普通索引
DEFINE INDEX term_domain_idx ON term COLUMNS domain;
DEFINE INDEX term_type_idx ON term COLUMNS type;
DEFINE INDEX term_version_idx ON term COLUMNS version_range;

-- 向量索引：MTREE（用于语义相似度检索）
DEFINE INDEX term_embedding_idx ON term TYPE MTREE COLUMNS embedding;

-- ------------------------------------------------------------
-- 关系表（使用 Graph Relation）- 核心改进
-- ------------------------------------------------------------

-- 定义为 RELATION TABLE（SurrealDB Graph 特性）
-- in 和 out 字段由 SurrealDB 自动管理
DEFINE TABLE term_relation SCHEMAFULL TYPE RELATION FROM term TO term;

-- 关系类型
-- is_a: 分类关系
-- part_of: 组成关系
-- uses: 使用关系
-- related_to: 相关关系
-- synonym: 同义关系
-- derived_from: 派生关系
-- configures: 配置关系
-- implements: 实现关系
-- version_of: 版本关系（新增）
DEFINE FIELD relation_type ON term_relation TYPE string;

-- 关系强度与可信度
DEFINE FIELD weight ON term_relation TYPE float DEFAULT 0.5;       -- 关系强度
DEFINE FIELD confidence ON term_relation TYPE float DEFAULT 0.5;   -- 关系可信度

-- 发现方法（新增：记录关系来源）
-- rule: 命名模式规则（可信度 0.95）
-- llm: LLM 上下文分析（可信度 0.90）
-- embedding: 向量语义相似度（可信度 0.75）
-- co_occurrence: 统计共现（可信度 0.50）
DEFINE FIELD method ON term_relation TYPE string DEFAULT 'co_occurrence';

-- 衰减因子（新增：用于共现关系的时间衰减）
-- decay_factor = e^(-λ × time_elapsed)
-- λ = 0.01（每月衰减约 1%）
DEFINE FIELD decay_factor ON term_relation TYPE float DEFAULT 1.0;

-- 证据与来源
DEFINE FIELD evidence ON term_relation TYPE string;    -- 关系证据（原文片段）
DEFINE FIELD source_doc ON term_relation TYPE string;  -- 来源文档

-- 版本信息（可选）
DEFINE FIELD version ON term_relation TYPE string DEFAULT ''; -- 特定版本

-- 时间戳
DEFINE FIELD created_at ON term_relation TYPE datetime;

-- ------------------------------------------------------------
-- 关系表索引
-- ------------------------------------------------------------

DEFINE INDEX relation_type_idx ON term_relation COLUMNS relation_type;
DEFINE INDEX relation_method_idx ON term_relation COLUMNS method;

-- ------------------------------------------------------------
-- 初始化种子术语（可选）
-- ------------------------------------------------------------

-- 可以在初始化时插入核心种子术语
-- 例如：
-- INSERT INTO term {
--   name: 'WAL',
--   normalized: 'wal',
--   namespace: 'database.wal',
--   domain: 'database',
--   type: 'concept',
--   aliases: ['Write-Ahead Logging', 'write-ahead log'],
--   description: 'Write-Ahead Logging ensures data durability',
--   frequency: 100,
--   confidence: 1.0,
--   source_docs: [],
--   created_at: time::now(),
--   updated_at: time::now()
-- };