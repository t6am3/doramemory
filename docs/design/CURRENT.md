# DoraMemory 设计文档 v1.0

**版本**: v1.0  
**日期**: 2026-04-09  
**状态**: 实现完成

---

## 一、项目定位

DoraMemory 是一个**类人分层时间记忆系统**，为 AI 编码助手（Claude Code、OpenClaw、Cursor 等）提供跨会话的长期记忆能力。

核心思想：模拟人类记忆的衰减和压缩——最近几小时的记忆清晰详细，更早的记忆逐步被提炼为关键事实和身份信息。

---

## 二、记忆层次结构

```
原始对话 ──→ second ──→ session ──→ hour ──→ rolling
(JSONL)     (按小时)   (按会话)    (按小时)   (四层滚动记忆)
                                              ├── identity   (我是谁)
                                              ├── recent     (近期事件)
                                              ├── distant    (远期摘要)
                                              └── lifetime   (终身知识)
```

### 2.1 各层职责

| 层 | 存储格式 | 职责 | 生命周期 |
|----|---------|------|---------|
| second | JSONL | 原始对话消息，按 UTC 小时分桶 | 永久保留，只读 |
| session | Markdown + frontmatter | 单个会话在某小时内的摘要，详细保真 | 被 hour 消化后标记 `compressed: true` |
| hour | Markdown + frontmatter | 某小时内所有 session 的增量合并 | 被 rolling 消化后用于 FIFO 展示 |
| rolling | 四个独立 Markdown 文件 | 滚动更新的长期记忆 | 每次有新 hour 时更新 |
| snapshots | 每层一个目录 | rolling 的时间点快照 | 随 rolling 更新自动生成 |

### 2.2 Rolling 四层

| 文件 | 预算 | 内容 |
|------|------|------|
| identity.md | 500 tokens | 用户身份、偏好、工作风格 |
| recent.md | 2000 tokens | 最近几天的详细事件 |
| distant.md | 1000 tokens | 更早期的关键摘要 |
| lifetime.md | 500 tokens | 跨月/跨年的核心知识 |

信息流向：新事件 → recent → distant → lifetime（随时间自然沉淀）

---

## 三、数据流全景

```
┌─────────────────────────────────────────────────────┐
│                 数据源 (只读)                          │
│  ~/.claude/projects/*/  (Claude Code JSONL)          │
│  ~/.openclaw/agents/*/sessions/  (OpenClaw JSONL)    │
│  ~/.cursor/  (Cursor JSONL)                          │
└──────────────────────┬──────────────────────────────┘
                       │ chokidar watch + cursor 增量读取
                       ▼
┌─────────────────────────────────────────────────────┐
│              Watcher + Parser                        │
│  识别文件格式 → 解析 JSONL → Bloom Filter 去重         │
│  → 写入 second/{UTC-hour}.jsonl                      │
└──────────────────────┬──────────────────────────────┘
                       │ triggerPartialCompression()
                       ▼
┌─────────────────────────────────────────────────────┐
│             事件驱动压缩调度                            │
│                                                      │
│  ① Session 压缩 (阈值: 16k tokens)                   │
│     某 session 的 partial + new >= 16000              │
│     → compressSessionPartial()                       │
│                                                      │
│  ② Rolling 触发 (阈值: 4k tokens)                     │
│     未滚动的 session 总量 >= 4000                      │
│     → runFullCompression():                          │
│        second → session (同小时内并行)                 │
│        session → hour                                │
│        hour → rolling (生成 snapshot)                 │
└──────────────────────┬──────────────────────────────┘
                       │ updateMemoryFile()
                       ▼
┌─────────────────────────────────────────────────────┐
│            MEMORY.md 构建                             │
│                                                      │
│  1. 身份层 (identity.md)                              │
│  2. 此前记忆 (rolling snapshot 或当前 rolling)         │
│  3. 最近动态 (hour FIFO, 最新→最旧, 总量 ≤ 4k)        │
│  4. 当前会话 (尚未被 hour 消化的 session)              │
│                                                      │
│  → 注入到 CLAUDE.md / MEMORY.md                      │
└─────────────────────────────────────────────────────┘
```

---

## 四、MEMORY.md 构建规则 (Builder)

### 4.1 Hour FIFO 机制

小时记忆采用 FIFO（先进先出）+ 总预算控制：

1. 读取所有 hour 文件，按时间**从新到旧**排列
2. 逐条累加 token 数，总量不超过 `total_max_tokens`（默认 4000）
3. 每条 hour 不超过 `max_tokens_per_entry`（默认 1000）
4. 超出预算的旧 hour 直接丢弃

### 4.2 Snapshot 兜底

当 FIFO 截断发生时，找到**最旧的被展示 hour 之前**的 rolling snapshot，作为"此前记忆"拼接。这确保被 FIFO 丢弃的旧小时信息通过 rolling 摘要得到延续。

### 4.3 最终结构

```markdown
## 我是谁
{identity.md 内容}

## 此前记忆
{snapshot 或 rolling 的 recent + distant + lifetime}

## 最近动态
#### 2026-04-09 14:00
{hour 内容}

#### 2026-04-09 13:00
{hour 内容}

## 当前会话
{尚未被 hour 消化的 session 摘要}
```

---

## 五、压缩 Prompt 设计

### 5.1 Session 压缩

定位：**保真优先**。"宁可多记也不要遗漏——后续压缩环节会处理精简，你这一步的职责是保真"。

保留要素：
- 关键数据（数字、ID、路径、配置值、错误码）
- 时间点
- 因果链（"因为X，所以Y"）
- 人物和态度
- 悬而未决的事项

### 5.2 Hour 压缩

定位：**增量合并**。只记这一小时新发生的事，不重复已有记忆中的信息。可以提及与前续事件的连续性。多个 session 讨论同一件事时合并成一条完整叙述。

### 5.3 Rolling 压缩

定位：**Agentic 多轮工具调用**。LLM 拥有四个工具自主编辑 rolling 文件：
- `read_memory(file)` — 读取某层当前内容
- `write_memory(file, content)` — 整体覆写
- `edit_memory(file, search, replace)` — 局部编辑
- `commit_memory(identity, recent, distant, lifetime)` — 提交所有修改

规则：层间不重复，新事件只进 recent，recent 满了才向 distant 沉淀。有遗忘能力（移除过时信息）。

---

## 六、事件驱动触发机制

取代了之前的 cron 整点触发，改为内容量水位驱动：

### 6.1 两级阈值

| 阈值 | 默认值 | 触发动作 |
|------|--------|---------|
| `session_compress_threshold` | 16000 tokens | 某 session 的 (partial + new) ≥ 阈值 → 触发该 session 的 partial 压缩 |
| `rolling_trigger_threshold` | 4000 tokens | 所有未滚动 session 总量 ≥ 阈值 → 触发 hour 合并 + rolling |

### 6.2 触发链路

```
用户发消息
  → watcher 检测文件变化
  → 解析 + 写入 second/
  → triggerPartialCompression(config)
     ├── 检查 session 阈值 → 压缩就绪的 session
     └── 检查 rolling 阈值 → runFullCompression()
          ├── second → session (并行)
          ├── session → hour
          ├── hour → rolling + snapshot
          └── updateMemoryFile()
```

### 6.3 设计优势

- 不会在整点集中触发大量模型调用
- 活跃用户更频繁更新，静默用户零开销
- 每个用户的压缩节奏由内容量自然决定

---

## 七、存储目录结构

```
~/.doramemory/
├── second/              # 原始消息 JSONL (2026-04-09T14.jsonl)
├── session/             # session 摘要 Markdown
├── hour/                # 小时增量摘要 Markdown
├── rolling/             # 四个滚动记忆文件
│   ├── identity.md
│   ├── recent.md
│   ├── distant.md
│   └── lifetime.md
├── snapshots/           # rolling 时间点快照
│   ├── identity/
│   ├── recent/
│   ├── distant/
│   └── lifetime/
├── core/
│   ├── identity.md      # 初始身份 (legacy)
│   └── recent/          # flashbulb 重要记忆
├── sessions/            # session 元数据 (.yaml)
├── index/
│   ├── message_ids.bloom  # Bloom Filter 去重
│   └── cursors/           # 文件读取偏移
├── traces/              # LLM 调用 trace
├── config.yaml          # 配置文件
├── doramemory.log       # 运行日志
├── daemon.pid           # PID 锁
└── daemon.heartbeat     # 心跳
```

---

## 八、LLM 调用与校验

### 8.1 compress_as 工具

Session 和 hour 压缩使用 `compress_as` 单轮 tool-use：
- LLM 必须调用此工具提交压缩结果
- 工具校验 token 上限，超限返回错误要求重试
- 最多重试 3 次，最终 fallback 强制截断
- 如果 LLM 不调用工具（返回纯文本），重试一次并提示必须调用

### 8.2 Rolling 多轮工具

Rolling 使用 4 个工具的多轮 agentic 对话（最多 10 轮）：
- 支持 locked files（低层空间充足时锁定不可改）
- commit 时校验每个文件的 token 上限
- 超限可重试 3 次

### 8.3 支持的 LLM Provider

| Provider | 协议 | 说明 |
|----------|------|------|
| anthropic | Anthropic Messages API | 默认 |
| oai-completion | OpenAI Chat Completions | 兼容大多数第三方 |
| oai-response | OpenAI Responses API | |

---

## 九、用户旅程

### 9.1 首次安装

```bash
# 安装
npm install -g doramemory

# 交互式初始化
npx doramemory init
```

初始化流程：
1. 自动检测本机已安装的 AI agent（Claude Code / OpenClaw / Cursor）
2. 选择要监控的 agent 和项目目录
3. 配置 LLM 提供商（API Key、Model ID、Base URL）
4. 生成 `~/.doramemory/config.yaml`
5. 可选：注入 MCP 配置到 Claude Desktop
6. 可选：立即压缩存量数据

### 9.2 存量数据压缩

```bash
# 压缩所有历史对话（首次使用）
npx doramemory compress

# 清除已有压缩重新开始
npx doramemory compress --fresh

# 限制处理小时数
npx doramemory compress --limit 10
```

批量压缩流程：
1. 扫描所有 watch target 下的 JSONL 文件
2. 解析 + 去重 + 写入 second/ 层
3. 逐小时处理：session 压缩（同小时内并行）→ hour 压缩 → rolling 更新
4. 每个小时完成后生成 rolling snapshot
5. 最终更新 MEMORY.md

### 9.3 后台守护

```bash
# 前台启动（调试用）
npx doramemory start

# 安装为 macOS launchd 后台服务
npx doramemory install

# 卸载后台服务
npx doramemory uninstall

# 查看状态
npx doramemory status
```

守护进程行为：
1. 获取 PID 锁，防止多实例
2. 加载 Bloom Filter
3. 执行追赶压缩（处理离线期间积累的数据）
4. 启动 chokidar 文件监控
5. 每次有新对话消息时触发事件驱动压缩
6. 定期心跳写入

### 9.4 记忆检索与修正

```bash
# 搜索记忆
npx doramemory recall "关键词"
npx doramemory recall --from 2026-04-01 --to 2026-04-09

# 标记重要记忆
npx doramemory remember --flashbulb <id>

# 修正记忆内容
npx doramemory remember --edit <id>
```

### 9.5 MCP 集成

DoraMemory 提供 MCP 协议服务器，AI agent 可以通过 MCP 直接：
- `memory_recall` — 搜索历史记忆
- `memory_remember` — 标记或修正记忆

```bash
npx doramemory mcp
```

---

## 十、配置参考

```yaml
# ~/.doramemory/config.yaml

watch:
  - path: ~/.claude/projects
    format: claude
  - path: ~/.openclaw/agents
    format: openclaw

compression:
  provider: anthropic        # anthropic | oai-completion | oai-response
  model_id: claude-haiku-4-5-20251001
  # api_key: 环境变量 ANTHROPIC_API_KEY
  # base_url: 自定义 API 地址

memory_budget:
  session:
    max_entries: 10
    max_tokens_per_entry: 1000
  hour:
    max_entries: 48
    max_tokens_per_entry: 1000
    total_max_tokens: 4000       # FIFO 总预算
  rolling:
    recent:   { max_tokens: 2000 }
    distant:  { max_tokens: 1000 }
    lifetime: { max_tokens: 500 }
    identity: { max_tokens: 500 }

session_compress_threshold: 16000  # session partial 压缩触发阈值
rolling_trigger_threshold: 4000    # rolling 触发阈值

memory_file: CLAUDE.md             # 注入目标文件
```

---

## 十一、支持的数据源

### Claude Code
- 路径：`~/.claude/projects/{project-dir}/{session-uuid}.jsonl`
- 特点：扁平结构，每个文件一个 session，支持 compact_boundary（可利用摘要）
- Session ID：文件名 UUID 前 8 位

### OpenClaw
- 路径：`~/.openclaw/agents/{agent-name}/sessions/{session-uuid}.jsonl`
- 特点：多 agent（main/nobita/shizuka 等），有 compaction 机制（当前 safeguard 模式无摘要）
- Session ID：文件名 UUID 前 8 位（不区分 agent）
- 注意：`.deleted` / `.reset` 后缀文件自动跳过

### Cursor
- 路径：`~/.cursor/`
- 格式：与 Claude Code 兼容

---

## 十二、已知限制

1. **Token 估算偏差**：`CHARS_PER_TOKEN=4` 对中文内容低估约 2-3 倍，导致实际 token 用量高于配置预算
2. **OpenClaw agent 不区分**：多个子 agent 的会话混在一起，session ID 不包含 agent 标识
3. **UTC 时间分桶**：小时文件按 UTC 时间分桶，对东八区用户显示可能造成困惑（如 T04 = 北京时间 12:00）
4. **Rolling 层间重复**：依赖 LLM 遵守"层间不重复"规则，弱模型可能出现 recent 和 distant 内容重复
