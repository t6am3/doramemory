# DoraMemory — 工作原理

> AI Agent 的长期记忆系统。通过分层压缩与滚动遗忘机制，让 AI 在有限的上下文窗口中拥有跨会话的持久记忆。

---

## 核心亮点

- **仿人类记忆的分层架构** — 5 层记忆（identity → lifetime → distant → recent → session），越近越详细，越远越抽象
- **LLM 驱动的智能压缩** — 不是机械裁剪，而是让 AI 自己决定什么值得记住、什么可以遗忘
- **严格的 Token 预算控制** — 总输出 ~12K tokens，在上下文窗口的 1% 内塞下数月的对话历史
- **滚动遗忘，永不溢出** — 旧记忆自动沉淀到更深层，系统永远不会因为对话太多而崩溃
- **快照一致性** — session 与 rolling 层通过时间对齐的快照机制避免信息重叠
- **零侵入注入** — 通过 MEMORY.md 文件注入 Agent 的 system prompt，不修改任何 Agent 代码
- **多项目角色感知** — 自动标记 `your_role`，让 AI 知道"我当时是以什么身份做了这件事"
- **后台守护进程** — Daemon 自动 watch、压缩、rolling，用户完全无感

---

## 目录

1. [为什么需要 DoraMemory](#1-为什么需要-doramemory)
2. [核心设计思想](#2-核心设计思想)
3. [系统架构总览](#3-系统架构总览)
4. [数据层次模型](#4-数据层次模型)
5. [数据流：从原始对话到记忆注入](#5-数据流从原始对话到记忆注入)
6. [压缩引擎详解](#6-压缩引擎详解)
7. [滚动记忆与遗忘机制](#7-滚动记忆与遗忘机制)
8. [MEMORY.md 的构建与注入](#8-memorymd-的构建与注入)
9. [Token 预算体系](#9-token-预算体系)
10. [时间模型与日边界](#10-时间模型与日边界)
11. [项目标记与角色身份](#11-项目标记与角色身份)
12. [守护进程与调度](#12-守护进程与调度)
13. [MCP 与 CLI 接口](#13-mcp-与-cli-接口)
14. [配置参考](#14-配置参考)

---

## 1. 为什么需要 DoraMemory

AI Agent（如 Claude Code、OpenClaw）每次对话都是"失忆"的——它看不到上一轮对话的任何内容。当用户长期使用 Agent 处理复杂项目时，Agent 每次都需要从零了解用户背景、项目状态、历史决策。

DoraMemory 解决的核心问题：**让 AI 拥有跨会话的长期记忆，而不超出上下文窗口的 token 限制。**

它的做法不是简单地存储所有历史对话（那会迅速超出任何模型的上下文窗口），而是模拟人类记忆的层次化结构：

- **最近的事**记得很清楚（recent）
- **较早的事**只记得大概脉络（distant）
- **很久以前的事**只记得里程碑（lifetime）
- **关于自己的认知**始终清晰（identity）

通过持续的压缩和滚动遗忘，DoraMemory 将几十万 token 的对话历史浓缩到几千 token 的记忆块中，注入到 Agent 的 system prompt 里。

---

## 2. 核心设计思想

### 2.1 分层压缩

信息沿一个方向流动：`原始对话 → 会话摘要 → 近期记忆 → 远期记忆 → 永久记忆`。每一层的压缩比不同，越往下越抽象、越精炼。

### 2.2 时间衰减

新鲜的记忆保留更多细节，陈旧的记忆逐渐模糊。这不是简单的 FIFO 队列，而是由 LLM 自主决定哪些细节值得保留、哪些可以遗忘。

### 2.3 预算约束

每一层都有严格的 token 预算。当某一层快满时，系统会触发"沉淀"——将旧内容压缩后向下一层移动，腾出空间给新内容。

### 2.4 快照一致性

Rolling 层（recent/distant/lifetime/identity）的内容会随着新会话的消化不断更新。但 MEMORY.md 中同时展示 session 摘要和 rolling 内容时，需要确保两者在时间线上不重叠。DoraMemory 通过 **快照机制** 解决这个问题——每次 rolling 压缩时拍快照，构建 MEMORY.md 时使用与可见 session 时间对齐的历史快照。

---

## 3. 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        DoraMemory 系统                          │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │ Watcher  │───▶│  Writer  │───▶│Compressor│───▶│  Builder  │ │
│  │(chokidar)│    │ (second) │    │ (LLM)    │    │(MEMORY.md)│ │
│  └──────────┘    └──────────┘    └──────────┘    └───────────┘ │
│       ▲                              │                   │      │
│       │                              ▼                   ▼      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐ │
│  │ Scheduler│    │ LLM      │    │ Snapshots│    │ Agent的    │ │
│  │ (触发器) │    │ Client   │    │ (时间线) │    │ System    │ │
│  └──────────┘    └──────────┘    └──────────┘    │ Prompt    │ │
│                                                   └───────────┘ │
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │   MCP    │    │   CLI    │    │  Daemon  │                  │
│  │  Server  │    │ Commands │    │ (后台)   │                  │
│  └──────────┘    └──────────┘    └──────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **Watcher** | `daemon/watcher.ts` | 监控 Agent 产品的 JSONL 对话文件变化 |
| **Writer** | `storage/writer.ts` | 去重、截断后写入 second 层 |
| **Compressor** | `storage/compressor.ts` | 调用 LLM 执行三级压缩 |
| **Builder** | `memory/builder.ts` | 组装 MEMORY.md 记忆块 |
| **Scheduler** | `daemon/scheduler.ts` | 事件驱动的压缩触发器 |
| **LLM Client** | `llm/client.ts` | 多协议 LLM 调用（Anthropic / OAI） |
| **Search Index** | `memory/search-index.ts` | 基于 MiniSearch 的记忆搜索 |

---

## 4. 数据层次模型

DoraMemory 的数据存储在 `~/.doramemory/` 下，分为以下层次：

### 4.1 Second 层（原始消息）

```
~/.doramemory/second/
├── 2026-04-10T08.jsonl   # 每小时一个文件
├── 2026-04-10T09.jsonl
└── ...
```

- 存储去重后的原始对话消息（JSONL 格式）
- 每条记录包含：message_id、session_id、role、content、timestamp、project
- 通过 **Bloom Filter** 实现高效去重，避免重复写入
- 单条消息超过 16000 字符会被截断

### 4.2 Session 层（会话摘要）

```
~/.doramemory/session/
├── 2026-04-10-dd5403.md          # 完成的会话
├── 2026-04-10-c5af8d-partial.md  # 进行中的会话
└── ...
```

- 每个文件是一次会话的 LLM 压缩摘要
- 文件名格式：`{日期}-{session_id前6位}.md`
- `-partial` 后缀表示会话仍在进行中（增量压缩）
- 包含 YAML frontmatter（id、title、flashbulb、project、compressed_at 等）

### 4.3 Rolling 层（滚动记忆）

```
~/.doramemory/rolling/
├── identity.md   # 身份认知（~500 tok）
├── recent.md     # 近期记忆（~2000 tok）
├── distant.md    # 远期记忆（~1000 tok）
└── lifetime.md   # 永久记忆（~500 tok）
```

四个文件代表四个不同时间尺度的记忆层：

| 层级 | 内容 | 时间粒度 | 更新频率 |
|------|------|---------|---------|
| **identity** | 用户画像、行事原则、关键人物 | 无时间维度 | 仅在身份信息变化时 |
| **recent** | 最近几天的具体事件 | 按天组织 | 每次 rolling 压缩 |
| **distant** | 较早的概括摘要 | 按周/月 | recent 满时沉淀 |
| **lifetime** | 重大里程碑和转折点 | 里程碑式 | distant 满时沉淀 |

### 4.4 Snapshot（快照）

```
~/.doramemory/snapshots/
├── recent/
│   ├── 2026-04-09.md
│   └── 2026-04-10.md
├── distant/
│   └── ...
├── lifetime/
│   └── ...
└── identity/
    └── ...
```

每次 rolling 压缩后，当前四个 rolling 文件的副本会被保存为快照。快照用于确保 MEMORY.md 中 rolling 内容与 session 列表在时间线上的一致性。

---

## 5. 数据流：从原始对话到记忆注入

```
Agent 产品的对话日志（.jsonl）
    │
    │ ① Watcher 检测文件变化
    ▼
Writer 去重 + 写入 second 层
    │
    │ ② Scheduler 检测 token 阈值
    ▼
┌───────────────────────────────────┐
│         压缩管线（Pipeline）        │
│                                   │
│  second → session (partial/full)  │
│  session → rolling (4层)          │
│  rolling → snapshot               │
└───────────────────────────────────┘
    │
    │ ③ Builder 组装记忆块
    ▼
MEMORY.md / CLAUDE.md（注入到 Agent 的上下文中）
```

### 详细步骤

1. **监控与摄入**：chokidar 监控 Agent 产品的对话目录（如 `~/.claude/projects/`），检测到新的或变更的 JSONL 文件后，解析每一行消息。

2. **去重与写入**：通过 Bloom Filter 检查 message_id 是否已处理。新消息写入 `second/{date}T{hour}.jsonl`。

3. **会话压缩触发**：当某个活跃会话的未压缩 token 数达到阈值（默认 16000），触发 partial 压缩。

4. **Rolling 压缩触发**：当 session 层中未被 rolling 消化的总 token 数达到阈值（默认 4000），触发 rolling 压缩。

5. **记忆刷新**：压缩完成后，重新构建 MEMORY.md 并写入目标文件。

---

## 6. 压缩引擎详解

DoraMemory 有三种压缩模式，每种使用不同的 LLM 提示策略。

### 6.1 会话全量压缩（Second → Session）

```
compressSecondToSession(sessionId, date, ...)
```

- **触发时机**：一天结束时（日边界切换），或存量压缩
- **输入**：某个 session 某一天的所有原始消息
- **输出**：一个 session md 文件（`{date}-{short}.md`）
- **特点**：
  - 要求 LLM 产出"叙事体"摘要，保留关键技术细节和决策
  - 支持**跨天上下文**：如果同一 session 在前一天有压缩结果，会作为背景注入 prompt
  - 使用 `compress_as` 工具调用模式，LLM 必须通过工具提交结果

### 6.2 会话增量压缩（Partial）

```
compressSessionPartial(sessionShort, ...)
```

- **触发时机**：活跃会话的新增 token 达到阈值
- **两种模式**：
  - **首次 partial**：没有已有 partial 文件，直接压缩新消息
  - **增量合并**：已有 partial，将旧 summary + 新消息合并压缩
- **输出**：`{date}-{short}-partial.md`

### 6.3 滚动压缩（Session → Rolling 四层）

```
compressRolling(newContent, id, ...)
```

这是最复杂的压缩模式，使用 **LLM Agent + Tool Use** 的方式：

**工具集**：
| 工具 | 作用 |
|------|------|
| `read_memory` | 读取某层当前内容 |
| `write_memory` | 全量写入某层（支持 append/settle_in/settle_out/forget） |
| `edit_memory` | 局部替换某层内容 |
| `commit_memory` | 提交所有修改，触发预算校验 |

**操作权限矩阵**：

| action | identity | recent | distant | lifetime |
|--------|----------|--------|---------|----------|
| append | ✅ | ✅ | 🚫 | 🚫 |
| settle_in | — | — | ✅ | ✅ |
| settle_out | — | ✅ | ✅ | — |
| forget | 🚫 | 🚫 | 🚫 | ✅ |

- **append**：写入新内容，仅限 recent 和 identity
- **settle_out**：从当前层移出内容（压缩后向下层沉淀）
- **settle_in**：接收上游层沉淀过来的内容
- **forget**：遗忘内容，仅限 lifetime

这些规则在代码层面强制执行——违反权限的操作会被工具直接拒绝。

**层间门控**：

```
recent 使用率 < 60% → 锁定 distant + lifetime（不需要沉淀）
distant 使用率 < 60% → 锁定 lifetime（distant 还有空间）
```

这避免了 LLM 在空间充裕时过早压缩和丢失细节。

---

## 7. 滚动记忆与遗忘机制

### 7.1 信息流向

```
新事件 ──append──▶ recent ──settle_out──▶ distant ──settle_out──▶ lifetime
                                           ▲                        ▲
                                      settle_in                settle_in

identity ◀──── 身份信息变化时单独更新
```

信息**只沿一个方向流动**：新事件先写入 recent，当 recent 满了才向 distant 沉淀，distant 满了才向 lifetime 沉淀。

### 7.2 遗忘的决策

LLM 在滚动压缩时扮演"记忆本身"的角色——它不是在做总结任务，而是在管理自己的记忆。Prompt 中明确指导了每一层应该保留什么、不保留什么：

- **identity**：只放"我是谁"，不放任何数字、URL、配置
- **recent**：按天组织，保留操作细节和悬而未决的事项
- **distant**：按周/月概括，只保留关键脉络
- **lifetime**：只放重大里程碑，极度精炼

### 7.3 快照与时间线一致性

问题：MEMORY.md 中同时显示 session 摘要和 rolling 内容。如果 rolling 已经消化了某些 session 的内容，但这些 session 还在展示，就会出现信息重复。

解决方案：

1. 每次 rolling 压缩时，将当前 4 个 rolling 文件保存为**快照**（以日期 ID 命名）
2. 构建 MEMORY.md 时，找到 session 列表中最老条目的 ID
3. 在快照中查找**早于该 ID** 的最新快照
4. 使用该快照的 rolling 内容（而不是最新的 rolling 文件）

这确保了 rolling 内容反映的是"这些 session 被消化之前"的记忆状态。

---

## 8. MEMORY.md 的构建与注入

### 8.1 输出结构

```xml
<!-- DORAMEMORY:START -->
<!-- 🧠 DoraMemory — AI 长期记忆系统（结构说明注释） -->

<!-- 🏷️ your_role: openclaw-nobita — 以下记忆来自该角色身份的历史对话 -->

<identity>
  用户画像、行事原则...
</identity>

<lifetime>
  重大里程碑...
</lifetime>

<distant>
  较早期概括...
</distant>

<recent>
  最近几天的事件...
</recent>

<sessions>

<session id="2026-04-10-dd5403" time="..." title="..." flashbulb="true" your_role="openclaw-nobita">
  会话摘要内容...
</session>

<session id="2026-04-10-c5af8d" time="..." title="..." your_role="openclaw-nobita">
  会话摘要内容...
</session>

</sessions>

<!-- 📖 DoraMemory 命令手册 -->
<!-- DORAMEMORY:END -->
```

### 8.2 注入方式

DoraMemory 支持两种注入方式：

1. **占位符替换**：文件中的 `{{DORAMEMORY}}` 会被替换为完整的记忆块
2. **标记区间替换**：`<!-- DORAMEMORY:START -->` 和 `<!-- DORAMEMORY:END -->` 之间的内容会被替换

### 8.3 Session 选择逻辑

1. 读取 session 目录下最新的 N 个文件（`max_entries` 控制）
2. 按 project 过滤（没有 project 的旧 session 对所有角色可见）
3. **去重**：当同一 session 同时有 completed 和 partial 版本时，只保留 completed
4. 按时间倒序（最新优先）逐条累加 token，直到达到 `max_tokens`（默认 4000）预算上限
5. 超出预算的老 session 自然被"pop"掉——它们已经被 rolling 消化了

---

## 9. Token 预算体系

### 9.1 默认预算

| 层级 | 预算 | 说明 |
|------|------|------|
| identity | 500 tok（rolling） / 200 tok（构建时） | 身份认知 |
| recent | 2000 tok | 近期记忆 |
| distant | 1000 tok | 远期记忆 |
| lifetime | 500 tok | 永久记忆 |
| session | 4000 tok（总量） | 最近会话摘要 |
| flashbulb | 2000 tok（独立预算） | 重要记忆标记 |

**总注入量**：约 500 + 2000 + 1000 + 500 + 4000 ≈ **8000 tokens**

### 9.2 Token 估算

```typescript
estimateTokens(text) = Math.ceil(text.length / 4)
```

使用 `CHARS_PER_TOKEN = 4` 的简化估算。对于中英混合文本，这是一个保守但实用的近似值。

### 9.3 预算执行

- **Session 层**：`buildMemoryBlock` 中按 `max_tokens` 截断，超出的 session 不展示
- **Rolling 层**：`commit_memory` 工具调用时校验每个文件的 token 是否在预算内
- **Flashbulb**：与普通 session 共享 `max_tokens` 预算（flashbulb 优先选入）

---

## 10. 时间模型与日边界

### 10.1 可配置的日边界

DoraMemory 的"一天"不是从 UTC 0:00 开始，而是可配置的：

```yaml
timezone_offset: 8      # UTC+8（北京时间）
day_boundary_hour: 4    # 凌晨 4 点切换日期
```

计算公式：`逻辑日偏移 = timezone_offset - day_boundary_hour`

例如：北京时间 2026-04-10 03:59 → 逻辑日期 2026-04-09；北京时间 2026-04-10 04:00 → 逻辑日期 2026-04-10。

### 10.2 集中式时间函数

```typescript
toLocalDate(d?: Date | string): string
```

所有需要"今天是哪天"的地方都调用 `toLocalDate()`，确保全系统使用统一的日边界。在 daemon 启动、CLI 命令入口处通过 `setDayBoundary()` 初始化。

---

## 11. 项目标记与角色身份

### 11.1 背景

同一个 DoraMemory 实例可能服务多个 Agent 产品（Claude Code、OpenClaw 等），每个产品又可能工作在不同的项目上。记忆需要标记"我当时是以什么身份做了这件事"。

### 11.2 Project 推断

```typescript
inferProject(filePath, format) → string
```

- Claude Code: 从路径 `.claude/projects/-Users-xxx-projects-{name}/` 提取 → `claude-code-{name}`
- OpenClaw: 从路径 `.openclaw/agents/{name}/` 提取 → `openclaw-{name}`
- OpenAI: 返回 `openai`

### 11.3 your_role 属性

每个 `<session>` 标签带有 `your_role` 属性，告诉 Agent "这段记忆是你作为哪个角色产生的"：

```xml
<session id="..." your_role="claude-code-doramemory">
```

Rolling 压缩时，每段被消化的 session 标题也会带 `[your_role: xxx]` 标记，prompt 中解释了这个标记的含义，让 LLM 在写高层记忆时保留角色上下文。

---

## 12. 守护进程与调度

### 12.1 Daemon 启动流程

```
doramemory daemon start
    │
    ├── 加载配置 + 设置日边界
    ├── 创建目录 + 获取 PID 锁
    ├── 注册信号处理（SIGINT/SIGTERM 关闭，SIGHUP 重载配置）
    ├── 加载 Bloom Filter
    ├── 存量追赶压缩（runCatchUp）
    ├── 启动 chokidar 文件监控（startWatcher）
    └── 初始化压缩状态（initPartialCompression）
```

### 12.2 事件驱动调度

DoraMemory 不使用定时轮询，而是**事件驱动**：

1. Watcher 检测到文件变化 → 调用 Writer 写入
2. 写入成功 → 调用 `triggerPartialCompression()`
3. Scheduler 检查：
   - 某个会话 token ≥ 16000 → 触发 session partial 压缩
   - 未消化总 token ≥ 4000 → 触发 rolling 压缩
4. 压缩完成 → 重建搜索索引 + 刷新 MEMORY.md

### 12.3 互斥锁

`compressionRunning` 标志防止并发压缩。如果上一轮压缩还在进行，新的触发会被跳过。

### 12.4 心跳机制

Daemon 每 30 秒更新 `~/.doramemory/heartbeat` 文件的时间戳，用于检测进程存活状态。

---

## 13. MCP 与 CLI 接口

### 13.1 MCP 工具

DoraMemory 通过 MCP (Model Context Protocol) 向 Claude Desktop 等客户端暴露两个工具：

| 工具 | 功能 |
|------|------|
| `memory_recall` | 语义搜索记忆（基于 MiniSearch，支持 CJK 分词） |
| `memory_remember` | 标记重要记忆（flashbulb）或修正摘要内容 |

### 13.2 CLI 命令

```bash
doramemory init              # 交互式初始化
doramemory init --config x   # 非交互式初始化
doramemory daemon start      # 启动守护进程
doramemory daemon stop       # 停止守护进程
doramemory daemon status     # 查看状态
doramemory inject <file>     # 注入记忆到指定文件
doramemory compress          # 手动触发存量压缩
doramemory refresh           # 手动刷新 MEMORY.md
doramemory sessions --from=  # 查询会话摘要
doramemory recall --query=   # 搜索记忆
doramemory remember <id>     # 标记/修正记忆
doramemory mcp               # 启动 MCP 服务器
```

### 13.3 Sessions 命令（Agent 增量拉取）

Agent 可以通过 CLI 增量拉取新的会话摘要：

```bash
# 首次查询
npx doramemory sessions --from=2026-04-10T00:00:00Z

# 后续查询（用上次返回的 now 作为 --from）
npx doramemory sessions --from=2026-04-10T12:00:00Z --max=5

# 按项目过滤
npx doramemory sessions --from=... --project=openclaw-nobita
```

---

## 14. 配置参考

配置文件位于 `~/.doramemory/config.yaml`：

```yaml
watch:
  - path: ~/.openclaw/agents
    format: openclaw
    memory_file: ~/.openclaw/workspace/MEMORY.md
    project: openclaw-nobita
  - path: ~/.claude/projects/-Users-xxx-projects-myproject
    format: claude
    memory_file: ~/projects/myproject/CLAUDE.md
    project: claude-code-myproject

compression:
  model:
    provider: anthropic          # anthropic | oai-completion | oai-response
    model_id: claude-haiku-4-5-20251001
    api_key: sk-ant-xxx
    base_url: https://api.anthropic.com  # 可选

memory_budget:
  identity:  { max_tokens: 200 }
  flashbulb: { max_tokens: 2000, max_entries: 5,  max_tokens_per_entry: 60  }
  session:   { max_tokens: 4000, max_entries: 10, max_tokens_per_entry: 1000 }
  rolling:
    recent:   { max_tokens: 2000 }
    distant:  { max_tokens: 1000 }
    lifetime: { max_tokens: 500  }
    identity: { max_tokens: 500  }

cold_start_days: 7                      # 存量压缩回溯天数
session_gap_minutes: 30                 # 会话间隔判定
session_compress_threshold: 16000       # 触发 session 压缩的 token 数
rolling_trigger_threshold: 4000         # 触发 rolling 压缩的 token 数
memory_update_throttle_seconds: 300     # MEMORY.md 刷新节流
timezone_offset: 8                      # 时区偏移（UTC+8）
day_boundary_hour: 4                    # 日边界（凌晨 4 点）
```

### 支持的 Agent 产品

| 产品 | 格式 | 默认监控路径 | 默认记忆文件 |
|------|------|-------------|-------------|
| Claude Code | `claude` | `~/.claude/projects/` | `CLAUDE.md` |
| OpenClaw | `openclaw` | `~/.openclaw/agents/` | `~/.openclaw/workspace/MEMORY.md` |
| Cursor | `openai` | `~/.cursor/conversations/` | `~/.cursor/.cursorrules` |

### 支持的 LLM 协议

| 协议 | 说明 |
|------|------|
| `anthropic` | Anthropic Messages API（推荐，原生 tool_use 支持） |
| `oai-completion` | OpenAI Chat Completions API（兼容大多数第三方） |
| `oai-response` | OpenAI Responses API |
