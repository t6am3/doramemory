# Changelog

All design versions and significant decisions are recorded here.

---

## [v0.9.2] — 2026-06-10

### Changed
- logger 写 stdout/stderr 失败时不再抛出全局异常，避免 `EPIPE: broken pipe` 在 daemon 异常处理里递归刷爆日志。
- daemon 全局异常处理增加递归保护，防止异常上报路径再次触发异常时形成无限循环。
- 默认将 `doramemory.log` 控制在约 50MiB 内并轮转到 `doramemory.log.1`，可通过 `DORAMEMORY_MAX_LOG_BYTES` 调整或设为 `0` 禁用。
- README 增加无损升级流程，明确升级不清空已有配置和压缩记忆，并标出 `init` / `compress --fresh` 的风险边界。

---

## [v0.9.1] — 2026-06-05

### Changed
- 后台服务安装改为平台感知：macOS 保留 launchd，Windows/Linux 使用 pm2 或手动管理。
- 子进程调用改为参数化执行，修复路径含空格时 launchctl/pm2 命令拼接失败的问题。
- 非交互初始化仅对路径字段展开 `~`、`$VAR`、`${VAR}`、`%VAR%`，避免误改其他配置值。
- MCP 配置路径按平台解析，Windows 写入 `%APPDATA%\Claude\claude_desktop_config.json`，命令使用 `npx.cmd`。
- OpenClaw session id、watcher project 推断、legacy 目录显示改为跨平台路径处理。
- 新增 `npm run check:compat`，覆盖当前平台和模拟 Windows 的路径/命令兼容断言。

---

## [v0.9] — 2026-04-08

### Changed
- MEMORY.md 生成模型重构：DoraMemory 不再注入当前会话消息，只提供 hour 及以上历史记忆（DDR-031）
- 废弃贪心预算分配算法，改为分层固定预算，每层互不侵犯（DDR-032）
- 压缩流程改为 agentic 模式，LLM 必须通过 compress_as tool 提交结果，写入前校验 token 限制（DDR-033）

### Added
- `memory_budget` 配置项：每层 max_entries + max_tokens_per_entry，全部可配置（DDR-034）
- `compress_as` tool 定义：layer / id / content / flashbulb，返回 success + tokens_used
- 默认预算方案：总计 ~3500 tokens，identity 200 + flashbulb 300 + hour 1200 + day 750 + week 400 + month 480 + year 180

### Removed
- ~~tokenCapForAge()~~ — 已在压缩时控制，builder 不再需要
- ~~truncateToTokens()~~ — 文件已经在限制内，builder 不再截断
- ~~贪心 token 预算分配~~ — 改为分层固定读取

---

## [v0.8] — 2026-04-08

### Added
- sessions/ 目录：每个 session 独立 yaml，存 started_at/last_active_at/compressed_to（DDR-028）
- 技术栈确定：TypeScript + chokidar + fastify + sqlite-vec + @modelcontextprotocol/sdk（DDR-029）
- v1 实现范围定义：Claude Code + Anthropic + second/hour/day 三层（DDR-030）
- 完整项目目录结构：cli/daemon/parsers/storage/index/memory/llm/mcp/http

### Changed
- 完整存储目录终稿，含 sessions/ 和 index/

---

## [v0.7] — 2026-04-08

### Added
- 完整安装流程：`npx doramemory init` 四步引导
- LLM 配置三种形态：Anthropic / OpenAI / custom，支持环境变量引用（DDR-026）
- Daemon 统一管理 FSWatcher + cron，launchd/systemd 注册（DDR-027）
- CLI 命令集：init / status / stop / restart / backfill / uninstall
- 卸载流程，默认保留数据

### Changed
- MEMORY.md 注入改为占位符方案 `{{DORAMEMORY}}`（DDR-025）
- 配置文件完整规范：watch / compression / embedding / 各项阈值

---

## [v0.6] — 2026-04-08

### Added
- /ingest 推送接口，作为 FSWatcher 的 fallback（DDR-021）
- message_id + bloom filter 去重，保证幂等（DDR-022）
- Embedding 策略：只写 day 及以上层级，cron 后批量更新（DDR-023）
- Recall 排序：grep + embedding 相似度 + 时间近度 tiebreaker（DDR-024）
- match_type 字段：告知 agent 结果的命中方式
- index/ 目录：bloom filter + embeddings.db + cursors/

---

## [v0.5] — 2026-04-08

### Changed
- /write 接口消失，改为文件监控守护进程（DDR-018）
- 对外接口从三个减为两个：/recall + /remember

### Added
- cursor 文件追踪增量读取，保证幂等（DDR-019）
- 冷启动策略：默认回溯 7 天，支持手动 backfill（DDR-020）
- session 边界推断规则（时间间隔 + 文件粒度）
- 并发写入处理：MEMORY.md 写入加文件锁
- oversize 消息异步处理
- MEMORY.md 更新频率控制
- .doraignore 隐私排除配置
- session resume 视图写入 sessions/{id}/view.md

---

## [v0.4] — 2026-04-07

### Changed
- 去除所有伪精度数值：fidelity 系数、numeric importance、衰减公式（DDR-013）
- /compress → /write，职责收窄为纯 IO 写入 second/
- 框架 context 管理与 DoraMemory 完全分离（DDR-017）
- 长存续 session：gap injection → session-aware 视图实时重建（DDR-016）

### Added
- Flashbulb 由压缩过程中 LLM 识别产生，不再是阈值/人工触发（DDR-014）
- core/ 双层结构：recent/（具体事件，上限 N 条）+ identity.md（≤200 tokens）（DDR-015）
- MEMORY.md 三层结构：身份层 + 重要记忆 + 近期时间流，总体积有界
- 消息 oversize 处理：重要大消息立即生成 minute/ 摘要，噪音大消息截断
- session 元信息：started_at / last_active_at，支持 resume 检测
- Recall 时间范围查询：精度自动决定返回层级，sources 字段支持 drill-down

### Removed
- fidelity 相关所有字段和公式
- numeric importance（0~1 浮点数）
- flashbulb/ 独立目录（已在 v0.3 移除，identity 层是新增）

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
