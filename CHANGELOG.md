# Changelog

All design versions and significant decisions are recorded here.

---

## [v0.3] — 2026-04-07

### Changed
- 层级命名：L1~L5 → second/minute/hour/day/week/month/year（DDR-009）
- flashbulb：独立目录 → frontmatter `flashbulb: true` 原地标记（DDR-011）
- 注入机制：GET /memory 接口 → 直接维护 MEMORY.md 文件（DDR-012）

### Added
- 纯文件系统存储方案：目录即层级，YAML frontmatter + Markdown（DDR-010）
- 文件命名规则、compressed 状态追踪、cron 扫描逻辑
- write_level 配置：低频 agent 从 hour 起，高频从 minute 起
- 兼容各家 agent 产品的 memory 文件路径配置

### Removed
- GET /memory 对外接口（降级为内部方法）
- flashbulb/ 目录

---

## [v0.2] — 2026-04-07

### Changed
- 放弃 proxy 方案，确立"不修改原始 prompt"的设计原则（DDR-004）
- injection 改为纯时间驱动，按天分段，不再做语义相关性召回（DDR-006）
- recall 明确为 agent 主动发起，系统不自动注入语义相关记忆

### Added
- 四个明确接口：/compress、/memory、/recall、/remember
- fidelity 形式化衰减公式：fidelity(n) = α^n，α 与模型能力强相关（DDR-007）
- compress endpoint 作为记忆写入的唯一触发点（DDR-005）
- L1 内容不可编辑原则（DDR-008）
- /remember 对 L2+ 人工编辑后 fidelity 上调机制

---

## [v0.1] — 2026-04-07

### Added
- Initial design: hierarchical temporal memory system for AI agents
- Core concept: time-driven pooling layers (L0 raw → L4 yearly skeleton)
- Compression operators: Salience Filter, Pattern Extractor, Entity Tracker, Belief Updater, Narrative Weaver
- Retrieval scoring: semantic relevance × time decay weight × salience
- Literature survey: Generative Agents, MemGPT, H-MEM, R³Mem, Zep, Mem0, A-MEM

### Key Design Decisions
- DDR-001: Compression is time-boundary-triggered (daily/weekly/monthly/yearly)
- DDR-002: Different operator combinations at each compression level
- DDR-003: Flashbulb memories (high salience) resist compression and stay at L0
