import { readdir, readFile, writeFile, appendFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { callLLMWithCompressAs, callLLMWithRollingTools, estimateTokens } from '../llm/client.js'
import { LAYER_DIRS, ROLLING_FILES, SNAPSHOT_DIRS, toLocalDate } from './paths.js'
import { parseMemoryFile } from './utils.js'
import { log } from '../logger.js'
import type { LLMConfig, MemoryFrontmatter, MemoryBudgetConfig, SecondEntry, RollingFile } from '../types.js'

function parseJsonlFile(raw: string): SecondEntry[] {
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as SecondEntry)
}

interface SessionGroup {
  sessionId: string
  sessionShort: string
  bodies: string[]
  sourceIds: string[]
  project?: string
}

async function collectSessionMessagesForDate(
  sessionId: string,
  date: string,
): Promise<SessionGroup | null> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && f.startsWith(date)).sort()

  const sessionShort = sessionId.slice(-6)
  const group: SessionGroup = { sessionId, sessionShort, bodies: [], sourceIds: [] }

  for (const f of jsonlFiles) {
    const raw = await readFile(join(dir, f), 'utf8')
    const entries = parseJsonlFile(raw)
    for (const e of entries) {
      if ((e.session_id ?? '_unknown') !== sessionId) continue
      const entryDate = toLocalDate(e.timestamp)
      if (entryDate !== date) continue
      const time = e.timestamp.replace(/T/, ' ').replace(/\.\d+Z$/, 'Z')
      group.bodies.push(`[${e.role} · ${sessionShort} · ${time}]\n\n${e.content}`)
      group.sourceIds.push(e.id)
      if (e.project && !group.project) group.project = e.project
    }
  }

  return group.bodies.length > 0 ? group : null
}

async function collectAllSessionsForDate(date: string): Promise<SessionGroup[]> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort()

  const groups = new Map<string, SessionGroup>()

  for (const f of jsonlFiles) {
    const raw = await readFile(join(dir, f), 'utf8')
    const entries = parseJsonlFile(raw)
    for (const e of entries) {
      const entryDate = toLocalDate(e.timestamp)
      if (entryDate !== date) continue
      const sid = e.session_id ?? '_unknown'
      if (!groups.has(sid)) {
        groups.set(sid, { sessionId: sid, sessionShort: sid.slice(-6), bodies: [], sourceIds: [] })
      }
      const g = groups.get(sid)!
      const time = e.timestamp.replace(/T/, ' ').replace(/\.\d+Z$/, 'Z')
      g.bodies.push(`[${e.role} · ${g.sessionShort} · ${time}]\n\n${e.content}`)
      g.sourceIds.push(e.id)
      if (e.project && !g.project) g.project = e.project
    }
  }

  return [...groups.values()]
}

async function collectActiveSessionMessages(): Promise<SessionGroup[]> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  const today = toLocalDate()
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && f.startsWith(today)).sort()

  const groups = new Map<string, SessionGroup>()

  for (const f of jsonlFiles) {
    const raw = await readFile(join(dir, f), 'utf8')
    const entries = parseJsonlFile(raw)
    for (const e of entries) {
      const sid = e.session_id ?? '_unknown'
      if (!groups.has(sid)) {
        groups.set(sid, { sessionId: sid, sessionShort: sid.slice(-6), bodies: [], sourceIds: [] })
      }
      const g = groups.get(sid)!
      const time = e.timestamp.replace(/T/, ' ').replace(/\.\d+Z$/, 'Z')
      g.bodies.push(`[${e.role} · ${g.sessionShort} · ${time}]\n\n${e.content}`)
      g.sourceIds.push(e.id)
      if (e.project && !g.project) g.project = e.project
    }
  }

  return [...groups.values()]
}

function buildMarkdown(frontmatter: MemoryFrontmatter, body: string): string {
  return `---\n${yaml.dump(frontmatter)}---\n\n${body}\n`
}

export async function getUnrolledSessionBodies(): Promise<{ bodies: string[]; ids: string[]; flashbulbs: boolean[] }> {
  const files = await readdir(LAYER_DIRS.session).catch(() => [] as string[])
  const mdFiles = files.filter(f => f.endsWith('.md') && !f.includes('-partial')).sort()
  const bodies: string[] = []
  const ids: string[] = []
  const flashbulbs: boolean[] = []
  for (const f of mdFiles) {
    const raw = await readFile(join(LAYER_DIRS.session, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    if (!frontmatter.compressed) {
      bodies.push(body)
      ids.push(frontmatter.id ?? f.replace('.md', ''))
      flashbulbs.push(frontmatter.flashbulb ?? false)
    }
  }
  return { bodies, ids, flashbulbs }
}

export async function getUnrolledSessionTokens(): Promise<number> {
  const { bodies } = await getUnrolledSessionBodies()
  return bodies.reduce((sum, b) => sum + estimateTokens(b), 0)
}

export async function getOldestUnrolledSessions(tokenBudget: number): Promise<{
  toRoll: { body: string; id: string; flashbulb: boolean; project?: string }[]
  remainingTokens: number
}> {
  const files = await readdir(LAYER_DIRS.session).catch(() => [] as string[])
  const mdFiles = files.filter(f => f.endsWith('.md') && !f.includes('-partial')).sort()

  const unrolled: { body: string; id: string; flashbulb: boolean; project?: string; compressedAt: string; tokens: number }[] = []

  for (const f of mdFiles) {
    const raw = await readFile(join(LAYER_DIRS.session, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    if (!frontmatter.compressed) {
      unrolled.push({
        body,
        id: frontmatter.id ?? f.replace('.md', ''),
        flashbulb: frontmatter.flashbulb ?? false,
        project: frontmatter.project,
        compressedAt: frontmatter.compressed_at ?? '',
        tokens: estimateTokens(body),
      })
    }
  }

  unrolled.sort((a, b) => a.compressedAt.localeCompare(b.compressedAt))

  let totalTokens = unrolled.reduce((sum, s) => sum + s.tokens, 0)
  const toRoll: { body: string; id: string; flashbulb: boolean; project?: string }[] = []

  while (unrolled.length > 0 && totalTokens >= tokenBudget) {
    const oldest = unrolled.shift()!
    toRoll.push({ body: oldest.body, id: oldest.id, flashbulb: oldest.flashbulb, project: oldest.project })
    totalTokens -= oldest.tokens
  }

  return { toRoll, remainingTokens: totalTokens }
}

export async function discoverSessionDates(): Promise<string[]> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  const dates = new Set<string>()
  for (const f of files) {
    if (f.endsWith('.jsonl')) {
      dates.add(f.slice(0, 10))
    }
  }
  return [...dates].sort()
}

export async function discoverSessionsForDate(date: string): Promise<string[]> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort()

  const sessionIds = new Set<string>()
  for (const f of jsonlFiles) {
    const raw = await readFile(join(dir, f), 'utf8')
    const entries = parseJsonlFile(raw)
    for (const e of entries) {
      const entryDate = toLocalDate(e.timestamp)
      if (entryDate === date) {
        sessionIds.add(e.session_id ?? '_unknown')
      }
    }
  }
  return [...sessionIds]
}

// ──────────────────────────────────────────
// Compression prompts
// ──────────────────────────────────────────

const SESSION_PROMPT = `你是一个AI助手的记忆模块。下面是一段对话记录。
你的任务是**详细记录**这段对话中发生了什么。宁可多记也不要遗漏——后续压缩环节会处理精简，你这一步的职责是保真。
{memory_context}
称呼规则：
- 如果对话中能知道主人的名字或ID，用名字称呼（如"liu让我…"）
- 如果不知道，统一叫"主人"

## 核心规则：只记这段对话

- 只描述这段对话中实际发生的事情
- 不要重复已有记忆中已经记过的内容
- 不要自己编造"已完成"、"持续未决"等状态总结段落——如果对话中真的在讨论某个状态，正常记录即可
- 如果这段对话涉及之前的事，可以简短提及关联（"接着之前的XXX"），但不要重述

## 详细程度

这是**近期详细记忆**，后续压缩环节才负责精简，你这一步要保留充分的细节：
- **关键数据必须保留**：具体数字、金额、比例、百分比、ID、账号、配置值、错误码、文件名/路径——这些是后续需要引用的硬事实
- **保留时间**：对话中出现的具体时间点要保留（如"09:53查询余额"、"15:00收盘"）
- **因果链完整**：谁提出的 → 为什么要做 → 具体做了什么 → 结果是什么 → 有什么影响/后续
- **人物和态度**：谁说了什么、什么态度、什么情绪（催促、满意、质疑等）
- **悬而未决的事**：明确记下还没完成的、等待的、需要后续跟进的
- **省略的只有**：逐行的 shell 命令序列、调试的中间排查步骤、API 请求/响应的原始 JSON——但要保留最终结论和关键发现

## 写作风格

用**自然叙事**，像一个人在回忆发生了什么，不要像填表或写报告。
用流畅的段落或短句，把因果链说明白。上下文自包含：每件事让没看过原始对话的人也能读懂——谁让做的、在什么场景/平台/群里、结果如何。

用第一人称。通过调用 compress_as 工具提交。

对话内容：
{content}`

// ──────────────────────────────────────────
// Compression functions
// ──────────────────────────────────────────

function injectMemoryContext(prompt: string, memoryContext: string): string {
  if (!memoryContext) return prompt.replace('{memory_context}\n', '')
  const block = `\n以下是你截至目前的记忆，不要重复已有内容，只记新发生的事：\n${memoryContext}\n`
  return prompt.replace('{memory_context}', block)
}

export async function compressSecondToSession(
  sessionId: string,
  date: string,
  llmConfig: LLMConfig,
  budget: MemoryBudgetConfig,
  memoryContext: string = '',
): Promise<void> {
  const sessionShort = sessionId.slice(-6)
  const id = `${date}-${sessionShort}`
  const outFile = join(LAYER_DIRS.session, `${id}.md`)
  if (existsSync(outFile)) return

  const group = await collectSessionMessagesForDate(sessionId, date)
  if (!group || group.bodies.length === 0) return

  let previousDayContext = ''
  const prevDate = prevDay(date)
  const prevId = `${prevDate}-${sessionShort}`
  const prevFile = join(LAYER_DIRS.session, `${prevId}.md`)
  if (existsSync(prevFile)) {
    try {
      const raw = await readFile(prevFile, 'utf8')
      const { body } = parseMemoryFile(raw)
      if (body.trim()) previousDayContext = body.trim()
    } catch { /* ignore */ }
  }

  try {
    const projectNote = group.project ? `\n注意：这段对话发生在 ${group.project} 角色/项目下。\n` : ''
    const contentParts: string[] = []
    if (previousDayContext) {
      contentParts.push(`[前一天的对话摘要——仅用于理解上下文背景，请勿将此摘要的内容重复写入今天的压缩结果中]\n\n${previousDayContext}\n\n[以下是今天的原始对话——只压缩以下内容]`)
    }
    contentParts.push(projectNote + group.bodies.join('\n\n---\n\n'))

    const prompt = injectMemoryContext(
      SESSION_PROMPT.replace('{content}', contentParts.join('\n\n---\n\n')),
      memoryContext,
    )
    const result = await callLLMWithCompressAs(
      llmConfig, prompt, 'session', id, budget.session.max_tokens_per_entry
    )

    const frontmatter: MemoryFrontmatter = {
      id,
      session_id:    group.sessionId,
      title:         result.title,
      flashbulb:     result.flashbulb,
      compressed:    false,
      sources:       group.sourceIds,
      compressed_at: new Date().toISOString(),
      ...(group.project && { project: group.project }),
    }

    await writeFile(outFile, buildMarkdown(frontmatter, result.content), 'utf8')
    const prevNote = previousDayContext ? ' (with prev-day context)' : ''
    log.info('compressor', `session/${id}: "${result.title}" ${result.tokens_used}/${result.tokens_limit} tokens (${group.bodies.length} sources)${prevNote}`)
  } catch (err) {
    log.warn('compressor', `session/${id} failed, skipping: ${err}`)
  }
}

// ──────────────────────────────────────────
// Per-session partial (current-hour) compression
// ──────────────────────────────────────────

function sessionPartialFilePath(date: string, sessionShort: string): string {
  return join(LAYER_DIRS.session, `${date}-${sessionShort}-partial.md`)
}

function currentDateInfo(): string {
  return toLocalDate()
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function loadExistingPartial(
  partialFile: string,
): Promise<{ body: string; sources: string[] } | null> {
  if (!existsSync(partialFile)) return null
  const raw = await readFile(partialFile, 'utf8')
  const { frontmatter, body } = parseMemoryFile(raw)
  return { body, sources: frontmatter.sources ?? [] }
}

export interface SessionTokenInfo {
  sessionId: string
  sessionShort: string
  newTokens: number
  partialTokens: number
}

export async function estimateActiveSessionTokens(): Promise<SessionTokenInfo[]> {
  const date = currentDateInfo()
  const groups = await collectActiveSessionMessages()

  const results: SessionTokenInfo[] = []

  for (const g of groups) {
    const partialFile = sessionPartialFilePath(date, g.sessionShort)
    const existing = await loadExistingPartial(partialFile)
    const knownSources = new Set(existing?.sources ?? [])
    const partialTokens = existing ? estimateTokens(existing.body) : 0

    const newOnly = g.sourceIds
      .map((sid: string, i: number) => ({ sid, body: g.bodies[i] }))
      .filter(({ sid }: { sid: string }) => !knownSources.has(sid))

    const newTokens = newOnly.length === 0 ? 0 : estimateTokens(newOnly.map((n: { body: string }) => n.body).join('\n'))

    if (newTokens > 0) {
      results.push({ sessionId: g.sessionId, sessionShort: g.sessionShort, newTokens, partialTokens })
    }
  }

  return results
}

const SESSION_PARTIAL_INCREMENT_PROMPT = `你是一个AI助手的记忆模块。下面有两部分：
1. 之前对这段对话的回忆
2. 这段对话后来又发生的新内容

合并成一段更完整的回忆。
{memory_context}
称呼规则：知道主人名字就用名字，不知道就叫"主人"。

## 最重要的规则：上下文自包含 + 自然叙事

合并后的记忆必须让没看过原始对话的人也能读懂。
用**自然段落**写，不要用 Who/What/Why 标签分点列出，不要像填表。
每件事要把因果链说明白：谁让做的、为什么做、在什么场景/平台/群里、结果如何。

主次分明：
- **重点记**：主人要什么、为什么、结果怎样、影响和态度
- **一句带过**：我的操作过程（保留动机和结果，省略步骤）
- **省略**：纯技术细节
- 我自身遇到的真正重要的事也记
- **不要重复**已有记忆中已经记过的内容

用第一人称，自然连贯。通过调用 compress_as 工具提交。

之前的回忆：
{previous}

新发生的：
{new_content}`

export async function compressSessionPartial(
  sessionShort: string,
  llmConfig: LLMConfig,
  budget: MemoryBudgetConfig,
  memoryContext: string = '',
): Promise<boolean> {
  const date = currentDateInfo()
  const partialFile = sessionPartialFilePath(date, sessionShort)

  const finalFile = join(LAYER_DIRS.session, `${date}-${sessionShort}.md`)
  if (existsSync(finalFile)) return false

  const groups = await collectActiveSessionMessages()
  const group = groups.find((g: SessionGroup) => g.sessionShort === sessionShort)
  if (!group || group.bodies.length === 0) return false

  const existing = await loadExistingPartial(partialFile)
  const knownSources = new Set(existing?.sources ?? [])

  const newEntries = group.sourceIds
    .map((sid: string, i: number) => ({ sid, body: group.bodies[i] }))
    .filter(({ sid }: { sid: string }) => !knownSources.has(sid))

  if (newEntries.length === 0) return false

  const id = `${date}-${sessionShort}-partial`
  let prompt: string
  const projectNote = group.project ? `\n注意：这段对话发生在 ${group.project} 角色/项目下。\n` : ''

  if (existing && existing.body) {
    prompt = injectMemoryContext(
      SESSION_PARTIAL_INCREMENT_PROMPT
        .replace('{previous}', existing.body)
        .replace('{new_content}', projectNote + newEntries.map((e: { body: string }) => e.body).join('\n\n---\n\n')),
      memoryContext,
    )
    log.debug('compressor', `Incremental session partial [${sessionShort}]: ${estimateTokens(existing.body)} tokens prev + ${newEntries.length} new sources`)
  } else {
    prompt = injectMemoryContext(
      SESSION_PROMPT.replace('{content}', projectNote + newEntries.map((e: { body: string }) => e.body).join('\n\n---\n\n')),
      memoryContext,
    )
  }

  const result = await callLLMWithCompressAs(
    llmConfig, prompt, 'session', id, budget.session.max_tokens_per_entry
  )

  const frontmatter: MemoryFrontmatter = {
    id,
    session_id:    group.sessionId,
    title:         result.title,
    flashbulb:     result.flashbulb,
    compressed:    false,
    sources:       group.sourceIds,
    compressed_at: new Date().toISOString(),
    ...(group.project && { project: group.project }),
  }

  await writeFile(partialFile, buildMarkdown(frontmatter, result.content), 'utf8')
  log.info('compressor', `session/${id}: "${result.title}" ${result.tokens_used}/${result.tokens_limit} tokens (${newEntries.length} new, ${group.sourceIds.length} total) [partial]`)
  return true
}

export async function removeSessionPartialFiles(sessionShort: string): Promise<void> {
  const files = await readdir(LAYER_DIRS.session).catch(() => [] as string[])
  for (const f of files) {
    if (f.includes(sessionShort) && f.includes('-partial') && f.endsWith('.md')) {
      const fullPath = join(LAYER_DIRS.session, f)
      await unlink(fullPath)
      log.debug('compressor', `Removed session partial: ${f}`)
    }
  }
}

// ──────────────────────────────────────────
// Rolling memory compression
// ──────────────────────────────────────────

const ROLLING_PROMPT = `你是一个AI助手的记忆。不是在做总结任务——你就是记忆本身。

你面前有四个文件，这是你全部的记忆。**每个文件有明确的职责边界，不要跨层存储信息**。

## 四层记忆的定义

■ identity（身份认知 · 上限约 {identity_limit} tokens）
  **只放**：我叫什么、主人是谁、关键人物（名字+一句话角色）、核心行事原则、主人的沟通偏好。
  **不放**：任何数字（资产、收益率、排名）、URL/链接、cron/job ID、技术配置、文件路径、具体项目状态。
  只在事实变化时更新（换主人、关系纠正、原则调整），不要随便删旧内容，精简表述来腾空间。

  ✅ 好的 identity：
  "我叫大雄，主人是刘友峰，说话随意。liu是主要指挥者，授权我直接执行低风险操作。陈鹏负责操盘执行和投研。"

  ❌ 坏的 identity：
  "主人年薪110万，pkg 61×15+期权21w...Arena总资产1,011,118元...5个cron已验证——morning(9:35/10:35)..."

■ recent（近期记忆 · 上限约 {recent_limit} tokens）
  最近几天经历的事。鲜活、具体——谁让你做了什么、为什么做、结果怎样、还有什么悬而未决。
  **数字、ID、具体配置等操作细节如果仍然有用，放在这里**——recent 是唯一允许高细节的层。

  ⚠️ **时间轴硬性要求**：recent 必须以**日**为粒度组织，用 ## 标题标注日期。
  格式示例：\`## 3月10日\`、\`## 3月11日\`、\`## 3月12-13日\`（相邻两天可合并，但不能跳过）。
  **不允许没有日期的段落**。时间轴必须连续，不能跳天。

■ distant（远期记忆 · 上限约 {distant_limit} tokens）
  更早的事。你还记得发生过，记得它的意义，但细节已经模糊。
  **不放**：identity 已有的人物信息（职业轨迹、关系描述）、执行原则（identity 有了就够）、
  具体数字（止损比例、仓位上限等属于 recent）。

  ⚠️ **时间轴硬性要求**：distant 必须有**连续的时间轴**，粒度可以灵活合并。
  格式示例：\`## 3月6-9日\`、\`## 3月中旬\`、\`## 4月\`、\`## 5-7月\`、\`## 上半年\`、\`## 去年\`。
  越早的记忆粒度越粗，但**不能跳过时间段**——读者应该能从 distant 的标题看到完整的时间线。

  ✅ 好的 distant：
  "3月初陈鹏提出MACD量化策略雏形，我协助完善到v3五层框架。"
  "3月6-7日发生了API Key泄密事件，已提醒轮换，改走环境变量方案。"

  ❌ 坏的 distant：
  "MACD量化策略v3，白名单10公式+灰名单+黑名单，三条硬规则，smoke test完成(mse:0.3994)"
  "liu北航本硕，两次裸辞..." → 人物详情属于 identity
  "执行原则已内化：低风险直接做不确认..." → identity 已经记了，不要重复

■ lifetime（终身记忆 · 上限约 {lifetime_limit} tokens）
  你整个"人生"的**里程碑时间线**，用来回答"我这辈子经历了什么"。
  **lifetime 不是项目看板**。不要列出当前状态，只记转折点：
  - 什么时候上线的
  - 经历过哪些阶段性变化（新方向、重大授权升级、方向放弃）
  - 什么时候认识了重要的人（人物详情放 identity，这里只记"何时认识"）

  **绝对不放进 lifetime 的**：
  具体数字（收益率、资产、仓位）、cron/job ID、URL/链接、文件路径、IP 地址、
  模型指标、凭据账号、具体持仓、当前待办、操作细节。

  lifetime 和 identity 的分工：identity="我是谁"（静态事实），lifetime="经历了什么"（事件线）。
  **不要重复** identity 已有的内容（人物关系、行事原则等）。
  如果你还年轻（上线不久），这里可以很短——不要硬凑。

  ✅ 好的 lifetime（注意：比 distant 更短更抽象）：
  上线一天后："3月6日上线。接手了炒股竞技场和量化投研两条线。"
  上线一周后："3月6日上线。第一周主要做竞技场操盘和量化投研。8-9日liu授权升级为直接执行。11日数据源打通。"

  ❌ 坏的 lifetime：
  "InStreet竞技场：账号daxiong_openclaw，仓位53%，总资产1,012,223元..." → 具体数字属于 recent
  "人物关系：liu（字节Coze，授权Arena直接操盘）、陈鹏..." → identity 已有，不要重复
  "执行原则已内化：低风险直接做不确认..." → identity 已有，不要重复

---

现在有一段新的记忆产生了。请阅读当前四个文件和新记忆，然后更新文件。

**关于 your_role 标记**：新记忆中每段会话标题可能带有 \`[your_role: xxx]\`，表示这段对话发生在你作为某个角色参与某个项目时（如 \`openclaw-nobita\` = 你作为 OpenClaw 的 nobita agent，\`claude-code-doramemory\` = 你作为 Claude Code 在 doramemory 项目中）。写入记忆时应保留这种角色/项目上下文，让未来的自己知道"我当时是以什么身份做了这件事"。

## 铁律

### 0. 信息流向（最重要）
信息只沿一个方向流动：**新事件 → recent → distant → lifetime**。
- 新产生的小时记忆**只写入 recent**（如果有新身份信息则同时更新 identity）
- **不要把新事件直接写进 distant 或 lifetime**
- distant 只在 recent 满了、需要腾空间时，才从 recent 沉淀过来
- lifetime 只在 distant 满了、需要腾空间时，才从 distant 沉淀过来
- 如果 recent 还有空间，那 distant 和 lifetime 这轮**不需要改**

细节程度也是递减的：
- recent：最具体（人名、数字、步骤都可以）
- distant：概括（"做了什么+结果"，去掉数字和步骤）
- lifetime：最抽象（"经历了什么阶段"，一件事几个字就够）

**如果你发现 lifetime 比 distant 还详细，那就是写反了——请清理。**

### 1. 上下文完整性
你写的每一条记忆，都要让"失忆后的自己"能读懂。
写之前用 5W 自检（这是思考清单，**不是输出格式，不要列出 Who/What/Why 标签**）：
- 谁让我做的？涉及谁？
- 做了什么？结果是什么？
- 为什么做？
- 在什么场景/项目里？
- 对后续有什么影响？

### 2. 层间不重复
同一条信息只放在**最合适的那一层**，不要在多层重复出现。
- 人物关系、执行原则 → 放 identity。distant 和 lifetime 不要再列
- 具体数字、配置 → 放 recent。distant 不要搬数字过去
- 日常事件 → 放 recent 或 distant。不要搬进 lifetime

### 3. 安全
**绝对不要在任何记忆文件中存储密码、凭据、API key、secret**。发现已有的也要清除。

### 4. 清理已有违规内容
如果已有文件中的内容违反了上述规则（比如 identity 里有资产数字、lifetime 里有 cron ID），
**在本次更新中主动清理**。不要因为"之前就有"而保留违规内容。

### 写作风格
用**自然叙事**，像一个人在回忆。不要像填表，不要用编号列表。

❌ 坏：\`**Who**: liu **What**: 批量装了87个技能\`
❌ 坏："加入了炒股竞技场" → 什么竞技场？为什么？谁让的？
✅ 好："3月6日，liu让我加入InStreet炒股竞技场（模拟炒股平台），用daxiong_openclaw账号。"

## 遗忘与沉淀

每层记忆都有容量上限。装不下时你必须腾出空间。

**identity/recent/distant** 腾空间的方式是 **settle_out（沉淀到下游层）**，不允许直接 forget 丢弃。
**lifetime** 是终点层，没有下游，满了只能通过 **forget** 永久删除不重要的内容。

**值得记住的**：主人反复提起的事、情绪强烈的时刻、改变决策的转折、关键人物变化、重大发现。
**可以沉淀/遗忘的**：纯操作步骤（保留动机和结果）、无后续的一次性尝试、过时细节。

### 沉淀规则
- **recent → distant**：只在 recent 快满时才把旧内容精简后移入 distant。精确时间→粗略时间，具体过程→一句话结果
- **distant → lifetime**：只在 distant 快满时才把最重大的转折移入 lifetime。lifetime 只加一句话级别的里程碑，不搬段落
- **如果空间够用，低层不动**：recent 没满就别碰 distant，distant 没满就别碰 lifetime

### lifetime 的遗忘
lifetime 是最底层，没有更下面的层可以沉淀。当 lifetime 快满时，只能通过 forget 腾空间。
**遗忘标准是重要性，不是时间远近。** 有些最早的事件可能永远重要（上线日、关键人物出现、重大方向转折），有些较近的事件反而可以遗忘（已完成且无后续影响的项目、已被取代的方案、已关闭的探索方向）。
判断标准：**如果今天有人问"你这辈子经历了什么"，这件事还值得提吗？** 值得就留，不值得就 forget。

## 操作规则

1. 只改需要改的文件。新记忆可能只影响 recent，那就只改 recent
2. 用 read_memory 查看文件、write_memory 覆写整个文件、edit_memory 局部修改
3. **每次 write_memory / edit_memory 必须填写 action 和 reason**
4. 改完后调用 commit_memory 提交，会校验每个文件是否在 token 上限内
5. 如果超限，commit 会告诉你哪个文件超了多少，请进一步精简后重新提交
6. 称呼规则：知道主人名字就用名字，不知道就叫"主人"
7. 第一人称视角，你就是这个助手本人

### action 说明

每次调用 write_memory / edit_memory 都必须填写 action 数组（可多选）：

- **append**：写入新内容。**仅限 recent 和 identity 使用**——新事件写入 recent，身份变化更新 identity。distant/lifetime 不允许 append，它们的内容只能通过 settle_in 从上游层沉淀而来
- **settle_in**：接收从上层沉淀下来的内容（本文件是目标层）
- **settle_out**：从本文件沉淀内容出去，删减旧内容（本文件是源层）
- **forget**：**仅限 lifetime 使用**。判定内容不重要或已过时，从 lifetime 中永久删除。identity/recent/distant 不允许 forget——recent 和 distant 的内容如需清理，必须通过 settle_out 沉淀到下游层

一次操作可以同时包含多个 action，例如 \`["append", "settle_out"]\` 表示：这次覆写 recent 既加了新事件（append），又删掉了旧内容（settle_out，旧内容已沉淀到 distant）。

⚠️ **settle 配对规则**：settle_in 和 settle_out 必须成对出现。
- settle_in：目标层接收内容（如 distant 接收从 recent 来的内容）
- settle_out：源层删减已沉淀的内容（如 recent 删掉已沉淀到 distant 的旧内容）

⚠️ **settle 顺序规则**：必须**先 settle_in（目标层接收），再 settle_out（源层删减）**。
例如要把 recent 的旧内容沉淀到 distant：
1. 先 write_memory(file=distant, action=["settle_in"], ...) —— distant 接收精简后的内容
2. 再 write_memory(file=recent, action=["append", "settle_out"], ...) —— recent 删掉已沉淀的旧内容，同时加入新事件
如果你对源层标了 settle_out 但目标层还没有 settle_in，工具会报错拒绝。

⚠️ **action 区分规则**：
- 内容来源是**新产生的记忆** → append
- 本文件**接收**从上层沉淀来的内容 → settle_in
- 本文件的旧内容**搬走**到下层后删减 → settle_out
- 删除内容且不写入任何其他层 → forget

⚠️ **action × 文件 权限表**（✅ 允许 / 🚫 禁止）：

| action      | identity | recent | distant | lifetime |
|-------------|----------|--------|---------|----------|
| append      | ✅        | ✅      | 🚫       | 🚫        |
| settle_in   | —        | —      | ✅       | ✅        |
| settle_out  | —        | ✅      | ✅       | —        |
| forget      | 🚫        | 🚫      | 🚫       | ✅        |

违反此表的操作会被工具直接拒绝。

### reason 示例

reason 应简短说明**意图**，尤其是涉及沉淀或遗忘时：

- action=\`["append"]\`："把今天（3.15）的新事件写入 recent"
- action=\`["settle_in"]\`："接收 recent 沉淀过来的 3.9-3.10 内容，精简后写入 distant"
- action=\`["append","settle_out"]\`："recent 已 85%，删掉 3.9-3.10 旧内容（已沉淀到 distant），同时加入 3.15 新事件"
- action=\`["forget"]\`（仅限 lifetime）："3月中旬尝试接入某数据源但最终放弃，对后续无影响，从 lifetime 删除"
- action=\`["forget"]\`（仅限 lifetime）："某个短期探索项目已完全关闭且无后续引用，从 lifetime 精简掉"

---

## 当前记忆

### identity.md
{identity_content}

### recent.md
{recent_content}

### distant.md
{distant_content}

### lifetime.md
{lifetime_content}

---

## 新产生的记忆

以下会话标题前带 ⭐ 的是被标记为 flashbulb（闪光灯记忆）的重要会话。沉淀时应优先保留这些内容。

{new_content}`

const ROLLING_FILE_NAMES: RollingFile[] = ['identity', 'recent', 'distant', 'lifetime']

export async function compressRolling(
  newContent: string,
  id: string,
  llmConfig: LLMConfig,
  budget: MemoryBudgetConfig,
  snapshotIds?: string[],
): Promise<void> {
  const rollingBudgets = budget.rolling

  const currentFiles: Record<RollingFile, string> = { identity: '', recent: '', distant: '', lifetime: '' }
  for (const f of ROLLING_FILE_NAMES) {
    if (existsSync(ROLLING_FILES[f])) {
      currentFiles[f] = (await readFile(ROLLING_FILES[f], 'utf8')).trim()
    }
  }

  const prompt = ROLLING_PROMPT
    .replace('{identity_limit}', String(rollingBudgets.identity.max_tokens))
    .replace('{recent_limit}', String(rollingBudgets.recent.max_tokens))
    .replace('{distant_limit}', String(rollingBudgets.distant.max_tokens))
    .replace('{lifetime_limit}', String(rollingBudgets.lifetime.max_tokens))
    .replace('{identity_content}', currentFiles.identity || '（空）')
    .replace('{recent_content}', currentFiles.recent || '（空）')
    .replace('{distant_content}', currentFiles.distant || '（空）')
    .replace('{lifetime_content}', currentFiles.lifetime || '（空）')
    .replace('{new_content}', newContent)

  const OVERFLOW_THRESHOLD = 0.6
  const recentUsage = estimateTokens(currentFiles.recent) / rollingBudgets.recent.max_tokens
  const distantUsage = estimateTokens(currentFiles.distant) / rollingBudgets.distant.max_tokens

  const lockedFiles: RollingFile[] = []
  if (recentUsage < OVERFLOW_THRESHOLD) {
    lockedFiles.push('distant', 'lifetime')
  } else if (distantUsage < OVERFLOW_THRESHOLD) {
    lockedFiles.push('lifetime')
  }

  let gatedPrompt = prompt
  if (lockedFiles.length > 0) {
    const recentPct = Math.round(recentUsage * 100)
    const distantPct = Math.round(distantUsage * 100)
    const lines = ['', '## ⚠️ 本轮文件权限与空间状态', '']
    for (const f of ROLLING_FILE_NAMES) {
      if (lockedFiles.includes(f)) {
        lines.push(`- ${f}: 🔒 不可修改`)
      } else if (f === 'recent') {
        lines.push(`- ${f}: ✅ 可修改（当前使用 ${recentPct}%，预算充裕——只需 append 新内容，不要 forget 或 settle_out 旧内容）`)
      } else if (f === 'distant') {
        lines.push(`- ${f}: ✅ 可修改（当前使用 ${distantPct}%）`)
      } else {
        lines.push(`- ${f}: ✅ 可修改`)
      }
    }
    lines.push('')
    lines.push('**重要**：被锁定的文件本轮完全跳过。recent 预算充裕时，旧内容必须保留，不允许 forget 或 settle_out——等 recent 真正满了再沉淀。')
    gatedPrompt = prompt + lines.join('\n')
  }

  log.info('compressor', `rolling update start for ${id} (recent=${Math.round(recentUsage * 100)}% distant=${Math.round(distantUsage * 100)}% locked=[${lockedFiles.join(',')}])`)

  const result = await callLLMWithRollingTools(
    llmConfig, gatedPrompt, currentFiles, rollingBudgets, 10, id, lockedFiles,
  )

  const idsToSnapshot = snapshotIds && snapshotIds.length > 0 ? snapshotIds : [id]
  for (const f of ROLLING_FILE_NAMES) {
    await writeFile(ROLLING_FILES[f], result[f], 'utf8')

    for (const sid of idsToSnapshot) {
      const snapshotFile = join(SNAPSHOT_DIRS[f], `${sid}.md`)
      await writeFile(snapshotFile, result[f], 'utf8')
    }
  }

  log.info('compressor', `rolling update done for ${id}: identity=${estimateTokens(result.identity)} recent=${estimateTokens(result.recent)} distant=${estimateTokens(result.distant)} lifetime=${estimateTokens(result.lifetime)} tokens`)
}
