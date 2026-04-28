import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { LAYER_DIRS, IDENTITY_FILE, ROLLING_FILES, SNAPSHOT_DIRS } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'
import { estimateTokens } from '../llm/client.js'
import type { MemoryBudgetConfig, RollingFile } from '../types.js'

const DORAMEMORY_START = '<!-- DORAMEMORY:START -->'
const DORAMEMORY_END   = '<!-- DORAMEMORY:END -->'
const PLACEHOLDER      = '{{DORAMEMORY}}'

const STRUCTURE_COMMENT = `<!--
🧠 DoraMemory — AI 长期记忆系统
以下内容由 DoraMemory 自动维护，请勿手动编辑，修改将在下次刷新时被覆盖。

本区域使用 HTML 标签组织不同层次的记忆，每个标签有明确的开闭边界。
标签内部是 Markdown 格式的文本，可包含标题、列表等结构。

📐 记忆层次（从稳定到临时）：

<identity>
  你对用户的长期认知画像：身份背景、技术栈偏好、沟通风格、工作习惯等。
  跨会话稳定，只在用户特征发生变化时更新。

<lifetime>
  永久性重大事件与里程碑：职业变动、重要项目启动/交付、关键技术决策等。
  这些记忆极少更新，代表用户历史中最重要的转折点，永不遗忘。

<distant>
  较早期记忆的概括摘要，按周或月的粗粒度组织。
  随时间推移，具体细节逐渐模糊，只保留关键脉络。

<recent>
  最近几天的具体事件记录，按天组织。
  包含较详细的上下文和细节。

<sessions>
  最近会话摘要的容器，包含多个 <session> 标签。
  总量受 token 预算限制，超出预算的旧会话会被滚入上方的 rolling 层。
  这里只保留最新的、尚未被 rolling 完全消化的会话。

  <session id="..." time="..." title="..." flashbulb="true" partial="true" your_role="...">
    单次会话的压缩摘要。属性说明：
    · id         — 唯一标识符
    · time       — 会话时间
    · title      — 主题概要
    · flashbulb  — 值为 "true" 时表示 ⭐ 重要记忆，优先展示
    · partial    — 值为 "true" 时表示会话仍在进行中
    · your_role  — 产生这段记忆时你的角色身份（如 claude-code-doramemory = 你作为 Claude Code 在 doramemory 项目中的对话）
-->`

// Read the most recent N files from a layer directory, newest first.
// Only reads files with id strictly before `beforeId` (to exclude current time unit).
async function readLayerFiles(
  dir: string,
  maxEntries: number,
  beforeId?: string,
): Promise<{ id: string; body: string; flashbulb: boolean; title: string; project?: string }[]> {
  const files = await readdir(dir).catch(() => [] as string[])
  const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse()

  const results: { id: string; body: string; flashbulb: boolean; title: string; project?: string }[] = []
  for (const f of mdFiles) {
    if (results.length >= maxEntries) break
    const id = f.replace('.md', '')
    const isPartial = id.endsWith('-partial')
    const baseId = isPartial ? id.replace(/-partial$/, '') : id
    if (beforeId && !isPartial && baseId >= beforeId) continue

    const raw = await readFile(join(dir, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    results.push({ id, body, flashbulb: frontmatter.flashbulb, title: frontmatter.title ?? '', project: frontmatter.project })
  }

  return results
}

function formatLabel(id: string): string {
  // session: 2026-04-08-14-c123 → "04-08 14:00 [c123]"
  // session partial: 2026-04-08-14-c123-partial → "04-08 14:00 [c123] (进行中)"
  const sessionMatch = id.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})-([a-f0-9]+?)(-partial)?$/)
  if (sessionMatch) {
    const label = `${sessionMatch[1].slice(5)} ${sessionMatch[2]}:00 [${sessionMatch[3]}]`
    return sessionMatch[4] ? `${label} (进行中)` : label
  }
  // hour: 2026-04-08-14 → "04-08 14:00"
  if (id.match(/^\d{4}-\d{2}-\d{2}-\d{2}$/)) return `${id.slice(5, 10)} ${id.slice(11)}:00`
  // day: 2026-04-07 → "04-07"
  if (id.match(/^\d{4}-\d{2}-\d{2}$/)) return id.slice(5)
  // week: 2026-W14 → "W14"
  if (id.match(/^\d{4}-W\d{2}$/)) return id.slice(5)
  // month: 2026-03 → "2026年3月"
  if (id.match(/^\d{4}-\d{2}$/)) {
    const [y, m] = id.split('-')
    return `${y}年${parseInt(m)}月`
  }
  // year: 2026 → "2026年"
  if (id.match(/^\d{4}$/)) return `${id}年`
  return id
}

function sessionLabel(e: { id: string; title: string }): string {
  const timeLabel = formatLabel(e.id)
  return e.title ? `${timeLabel} — ${e.title}` : timeLabel
}

// ──────────────────────────────────────────
// Build MEMORY.md sections
// ──────────────────────────────────────────

export async function buildMemoryBlock(budget: MemoryBudgetConfig, asOf?: Date, project?: string): Promise<string> {
  const now = asOf ?? new Date()

  let identityContent = ''
  if (existsSync(ROLLING_FILES.identity)) {
    identityContent = (await readFile(ROLLING_FILES.identity, 'utf8')).trim()
  }
  if (!identityContent && existsSync(IDENTITY_FILE)) {
    identityContent = (await readFile(IDENTITY_FILE, 'utf8')).trim()
  }

  const allSessionEntries = await readLayerFiles(LAYER_DIRS.session, budget.session.max_entries)
  const sessionEntries = project
    ? allSessionEntries.filter(e => !e.project || e.project === project)
    : allSessionEntries
  const partials = sessionEntries.filter(e => e.id.endsWith('-partial'))
  const completed = sessionEntries.filter(e => !e.id.endsWith('-partial'))

  const completedBaseIds = new Set(completed.map(e => e.id))
  const dedupedPartials = partials.filter(e => !completedBaseIds.has(e.id.replace(/-partial$/, '')))

  const candidates = [
    ...completed.map(e => ({ ...e, isPartial: false })),
    ...dedupedPartials.map(e => ({ ...e, isPartial: true })),
  ]

  const sessionBudget = budget.session.max_tokens
  const selected: typeof candidates = []
  let tokensUsed = 0
  for (const e of candidates) {
    const t = estimateTokens(e.body)
    if (tokensUsed + t > sessionBudget && selected.length > 0) break
    selected.push(e)
    tokensUsed += t
  }

  const oldestSelectedId = selected.length > 0
    ? selected[selected.length - 1].id.replace(/-partial$/, '')
    : null

  const ROLLING_LAYER_ORDER: RollingFile[] = ['lifetime', 'distant', 'recent']

  const rollingContents: Record<string, string> = {}
  if (oldestSelectedId) {
    const snapshotId = await findSnapshotBefore(oldestSelectedId)
    if (snapshotId) {
      for (const f of ROLLING_LAYER_ORDER) {
        const snapFile = join(SNAPSHOT_DIRS[f], `${snapshotId}.md`)
        if (existsSync(snapFile)) {
          const content = (await readFile(snapFile, 'utf8')).trim()
          if (content) rollingContents[f] = content
        }
      }
    }
  }

  if (Object.keys(rollingContents).length === 0) {
    for (const f of ROLLING_LAYER_ORDER) {
      if (existsSync(ROLLING_FILES[f])) {
        const content = (await readFile(ROLLING_FILES[f], 'utf8')).trim()
        if (content) rollingContents[f] = content
      }
    }
  }

  const parts: string[] = []

  parts.push(DORAMEMORY_START)
  parts.push(STRUCTURE_COMMENT)

  if (project) {
    parts.push(`\n<!-- 🏷️ your_role: ${project} — 以下记忆来自该角色身份的历史对话 -->`)
  }

  if (identityContent) {
    parts.push(`\n<identity>\n\n${identityContent}\n\n</identity>`)
  }

  for (const f of ROLLING_LAYER_ORDER) {
    if (rollingContents[f]) {
      parts.push(`\n<${f}>\n\n${rollingContents[f]}\n\n</${f}>`)
    }
  }

  if (selected.length > 0) {
    const sessionParts: string[] = []
    for (const e of selected) {
      const timeLabel = formatLabel(e.id)
      const attrs = [
        `id="${e.id}"`,
        `time="${timeLabel}"`,
      ]
      if (e.title) attrs.push(`title="${e.title}"`)
      if (e.flashbulb) attrs.push('flashbulb="true"')
      if (e.isPartial) attrs.push('partial="true"')
      const role = e.project || project
      if (role) attrs.push(`your_role="${role}"`)

      sessionParts.push(`<session ${attrs.join(' ')}>\n\n${e.body}\n\n</session>`)
    }
    parts.push(`\n<sessions>\n\n${sessionParts.join('\n\n')}\n\n</sessions>`)
  }

  const displayedShorts = selected.map(e => {
    const m = e.id.match(/-([a-f0-9]{6})(-partial)?$/)
    return m ? m[1] : e.id.slice(-6)
  })
  const uniqueShorts = [...new Set(displayedShorts)]
  const excludeArg = uniqueShorts.length > 0 ? ` --exclude=${uniqueShorts.join(',')}` : ''
  const fromTs = now.toISOString()
  parts.push(`\n<!-- 📖 DoraMemory 命令手册

1. 查询新增会话（增量拉取本次注入后新压缩的会话摘要）
   npx doramemory sessions --from=${fromTs}${excludeArg}
   · 后续查询：用上次返回的 now 替换 --from，省略 --exclude
   · 分页：--max=5（默认）--offset=N，has_more=true 时继续
   · --by=compressed（默认）按压缩时间 | --by=time 按会话发生时间
   · --to=ISO_TIMESTAMP 限定上界
   · --project=角色名 只返回指定角色的会话（如 --project=claude-code-doramemory）
   · 返回: { sessions, returned, total, has_more, offset, by, now }

2. 搜索记忆（语义关键词检索所有层级的记忆）
   npx doramemory recall --query "关键词" --max=5 --offset=0
   · 返回: { results: [{ id, layer, score, file_path, snippet, ... }], returned, total_candidates, has_more, offset }

3. 修正记忆（标记重要/修正摘要内容）
   npx doramemory remember <memory_id> --layer session --flashbulb
   npx doramemory remember <memory_id> --layer session --no-flashbulb
   npx doramemory remember <memory_id> --layer session --content "修正后的内容"
-->`)

  parts.push(`\n${DORAMEMORY_END}`)

  const result = parts.join('\n')
  return result
}

async function findSnapshotBefore(sessionId: string): Promise<string | null> {
  const snapshotDir = SNAPSHOT_DIRS.recent
  if (!existsSync(snapshotDir)) return null
  const files = await readdir(snapshotDir).catch(() => [] as string[])
  const ids = files
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''))
    .sort()
    .reverse()
  const datePrefix = sessionId.slice(0, 10)
  for (const id of ids) {
    if (id < datePrefix) return id
  }
  return null
}

export async function buildMemoryContext(budget: MemoryBudgetConfig, asOf: Date, project?: string): Promise<string> {
  const block = await buildMemoryBlock(budget, asOf, project)
  if (!block) return ''
  return block
    .replace(DORAMEMORY_START, '')
    .replace(DORAMEMORY_END, '')
    .replace(STRUCTURE_COMMENT, '')
    .replace(/<!-- 🏷️ your_role:.*?-->/g, '')
    .replace(/<!-- 📖 DoraMemory 命令手册[\s\S]*?-->/g, '')
    .trim()
}

export async function updateMemoryFile(
  memoryFilePath: string,
  budget: MemoryBudgetConfig,
  project?: string,
): Promise<void> {
  const block = await buildMemoryBlock(budget, undefined, project)
  if (!block) return
  if (!existsSync(memoryFilePath)) return

  const content = await readFile(memoryFilePath, 'utf8')
  let updated: string

  if (content.includes(DORAMEMORY_START)) {
    updated = content.replace(
      new RegExp(`${DORAMEMORY_START}[\\s\\S]*?${DORAMEMORY_END}`),
      block
    )
  } else if (content.includes(PLACEHOLDER)) {
    updated = content.replace(PLACEHOLDER, block)
  } else {
    process.stderr.write(
      `[doramemory] Warning: ${PLACEHOLDER} not found in ${memoryFilePath}. ` +
      `Add {{DORAMEMORY}} to enable memory injection.\n`
    )
    return
  }

  await writeFile(memoryFilePath, updated, 'utf8')
}
