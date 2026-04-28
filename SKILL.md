# DoraMemory Skill

## DoraMemory 是什么

DoraMemory 是一个为 AI Agent 设计的层级时序记忆系统。它自动监控你的对话记录，压缩为多层记忆（session → rolling），并将记忆注入到你的 MEMORY 文件中。

## 记忆结构

- **身份记忆 (identity)**：你是谁，用户偏好
- **终身记忆 (lifetime)**：跨越所有时间的核心经验和模式
- **远期记忆 (distant)**：较早期的会话总结
- **近期记忆 (recent)**：最近几天的会话详情
- ⭐ **闪光灯记忆 (flashbulb)**：被标记为重要的会话
- **会话摘要 (session)**：每个对话的压缩摘要

## MEMORY 文件中的 DoraMemory 区域

- 由 `<!-- DORAMEMORY:START -->` 和 `<!-- DORAMEMORY:END -->` 标记包裹
- 此区域由 DoraMemory 系统自动维护，**请勿手动编辑**
- 内容会在每次会话结束时自动刷新，手动修改将被覆盖

## 如何使用

### 搜索记忆

```bash
npx doramemory recall --query "关键词" --max 5
```

返回 JSON 格式结果，包含 `snippet`（关键词用 `«»` 高亮）、`summary`、`file_path`、`score` 等字段。

### 标记重要记忆

```bash
npx doramemory remember <memory_id> --layer session --flashbulb
```

### 修正记忆

```bash
npx doramemory remember <memory_id> --layer session --content "修正后的内容"
```

### 查看状态

```bash
npx doramemory status
```

## 注意事项

- DoraMemory 区域的内容是自动生成的，不要试图修改它
- 如果需要修正某个记忆，使用 `doramemory remember` 命令
- 搜索结果中的 `file_path` 指向原始会话文件，可以获取更多上下文
- `flashbulb` 标记的记忆会在 MEMORY 文件中优先展示
