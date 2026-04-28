# DoraMemory

> Human-like hierarchical long-term memory for AI agents.

给 AI Agent 加上**类人记忆**。自动监控对话日志，通过多层压缩形成长期记忆，注入到 Agent 的 MEMORY 文件中。

### 输入 → 输出

```
输入：监控 *_session.jsonl 对话日志文件（Agent 每轮对话自动生成）
输出：注入 MEMORY.md（Agent 启动时自动读取的 system prompt 文件）
```

DoraMemory **只读取** `*_session.jsonl`，**只写入** `MEMORY.md`。不修改 Agent 代码，不侵入对话流程。

## 核心亮点

- **仿人类记忆的分层架构** — 5 层记忆（identity → lifetime → distant → recent → session），越近越详细，越远越抽象
- **LLM 驱动的智能压缩** — 不是机械裁剪，而是让 AI 自己决定什么值得记住、什么可以遗忘
- **严格的 Token 预算控制** — 总输出 ~12K tokens，在上下文窗口的 1% 内塞下数月的对话历史
- **滚动遗忘，永不溢出** — 旧记忆自动沉淀到更深层，系统永远不会因为对话太多而崩溃
- **零侵入注入** — 通过 MEMORY.md 文件注入 Agent 的 system prompt，不修改任何 Agent 代码
- **多项目角色感知** — 自动标记 `your_role`，让 AI 知道"我当时是以什么身份做了这件事"
- **后台守护进程** — Daemon 自动 watch、压缩、rolling，用户完全无感

## 工作原理

人的记忆会随时间自然衰减——刚发生的事记得清楚，几天前的只剩大概，更早的只记得关键事件。DoraMemory 模仿这个过程：

```
对话原文  →  会话摘要  →  滚动记忆（近期/远期/终身/身份）
(second)    (session)     (rolling)
```

详细原理见 [HOW-IT-WORKS.md](./HOW-IT-WORKS.md)。

## 支持的 Agent

| Agent | 格式 | 监控路径 |
|-------|------|---------|
| OpenClaw | openclaw | `~/.openclaw/agents/` |
| Claude Code | claude | `~/.claude/projects/` |
| 自定义 | OpenAI JSONL | 任意路径 |

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/user/doramemory.git
cd doramemory

# 安装依赖（需要 Node.js >= 18）
npm install

# 编译
npm run build

# 全局链接（可选）
npm link
```

### 配置

```bash
# 交互式配置（推荐首次使用）
doramemory init
```

或手动创建 `~/.doramemory/config.yaml`：

```yaml
watch:
  - path: ~/.openclaw/agents
    format: openclaw
    memory_file: ~/.openclaw/workspace/MEMORY.md
    project: my-project

compression:
  model:
    provider: anthropic          # 或 oai-completion / oai-response
    model_id: claude-haiku-4-5-20251001
    api_key: sk-ant-xxx
    # base_url: https://...     # OpenAI 兼容 API 时使用
```

更多配置示例见 [examples/](./examples/)。

### 准备 MEMORY 文件

在目标文件里加占位符：

```bash
echo '{{DORAMEMORY}}' >> ~/.openclaw/workspace/MEMORY.md
```

### 启动

```bash
# 前台启动
doramemory start

# 或安装为后台服务（开机自启）
doramemory install
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `doramemory init` | 交互式初始化配置 |
| `doramemory start` | 启动守护进程 |
| `doramemory stop` | 停止守护进程 |
| `doramemory install` | 安装为后台服务 |
| `doramemory status` | 查看运行状态 |
| `doramemory compress` | 手动压缩存量记忆 |
| `doramemory recall --query "关键词"` | 搜索记忆 |
| `doramemory sessions --from "2026-04-10"` | 查看会话摘要 |
| `doramemory refresh` | 手动刷新 MEMORY.md |
| `doramemory usage` | 查看 token 用量统计 |
| `doramemory mcp` | 启动 MCP server |

## 数据目录

```
~/.doramemory/
├── config.yaml           # 配置文件
├── second/               # 原始对话（按小时 JSONL）
├── session/              # 压缩后的会话摘要
├── rolling/              # 4 个滚动记忆文件
│   ├── identity.md
│   ├── recent.md
│   ├── distant.md
│   └── lifetime.md
├── snapshots/            # rolling 历史快照
├── search-index.json     # 全文搜索索引
└── doramemory.log        # 日志
```

## 技术栈

- **语言**: TypeScript / ESM
- **运行时**: Node.js >= 18
- **LLM SDK**: `@anthropic-ai/sdk`、`openai`（支持任何 OpenAI 兼容 API）
- **文件监控**: `chokidar`
- **全文搜索**: `minisearch`
- **消息去重**: `bloom-filters`
- **MCP**: `@modelcontextprotocol/sdk`

## 文档

- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) — 完整技术原理文档
- [docs/design/](./docs/design/) — 设计迭代文档

## License

[MIT](./LICENSE)
