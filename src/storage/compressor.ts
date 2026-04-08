import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { callLLM } from '../llm/client.js'
import { LAYER_DIRS, hourFilePath, dayFilePath } from './paths.js'
import type { LLMConfig, MemoryFrontmatter } from '../types.js'

// Parse frontmatter + body from a markdown file
function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2],
  }
}

function buildMarkdown(frontmatter: MemoryFrontmatter, body: string): string {
  return `---\n${yaml.dump(frontmatter)}---\n\n${body}\n`
}

// Get all uncompressed second/ files for a given date (YYYY-MM-DD)
async function getSecondFilesForDate(date: string): Promise<string[]> {
  const dir = LAYER_DIRS.second
  const files = await readdir(dir).catch(() => [] as string[])
  return files
    .filter(f => f.startsWith(date) && f.endsWith('.md'))
    .map(f => join(dir, f))
    .sort()
}

// Get all uncompressed hour/ files for a given date
async function getHourFilesForDate(date: string): Promise<string[]> {
  const dir = LAYER_DIRS.hour
  const files = await readdir(dir).catch(() => [] as string[])
  return files
    .filter(f => f.startsWith(date) && f.endsWith('.md'))
    .map(f => join(dir, f))
    .sort()
}

const HOUR_COMPRESS_PROMPT = `你是一个记忆压缩助手。下面是某一小时内的对话片段，请将它们压缩为一份简洁的摘要。

要求：
- 保留关键决策、重要结论、关键实体的状态变化
- 过滤掉重复、寒暄、无意义的内容
- 使用中性、客观的语言
- 输出纯文本摘要，不需要任何额外格式

对话内容：
{content}`

const DAY_COMPRESS_PROMPT = `你是一个记忆压缩助手。下面是某一天的多个小时摘要，请将它们压缩为一份日摘要。

要求：
- 按时间顺序组织（上午/下午/晚上）
- 突出这一天最重要的进展和决策
- 如果发现某个事件非常重要、值得长期记忆，在摘要末尾单独一行输出：
  FLASHBULB: <简短描述这个重要事件>
  （只在真正重要时才输出，不要滥用）
- 输出纯文本，FLASHBULB 行除外不需要特殊格式

小时摘要内容：
{content}`

export async function compressSecondToHour(
  date: string,
  hourStr: string,
  llmConfig: LLMConfig
): Promise<void> {
  const prefix = `${date}-${hourStr}`
  const outFile = hourFilePath(`${date}T${hourStr}:00:00Z`)

  if (existsSync(outFile)) return  // already compressed

  const secondFiles = (await getSecondFilesForDate(date))
    .filter(f => f.includes(prefix.replace('-', 'T').slice(0, 13)))

  if (secondFiles.length === 0) return

  const contents: string[] = []
  for (const f of secondFiles) {
    const raw = await readFile(f, 'utf8')
    const { body } = parseMemoryFile(raw)
    contents.push(body)
  }

  const prompt = HOUR_COMPRESS_PROMPT.replace('{content}', contents.join('\n\n---\n\n'))
  const summary = await callLLM(llmConfig, prompt)

  const sourceIds = secondFiles.map(f => f.split('/').pop()!.replace('.md', ''))
  const frontmatter: MemoryFrontmatter = {
    id:           prefix,
    flashbulb:    false,
    compressed:   false,
    sources:      sourceIds,
    compressed_at: new Date().toISOString(),
  }

  await writeFile(outFile, buildMarkdown(frontmatter, summary), 'utf8')

  // Mark source files as compressed
  for (const f of secondFiles) {
    const raw = await readFile(f, 'utf8')
    const { frontmatter: fm, body } = parseMemoryFile(raw)
    fm.compressed = true
    await writeFile(f, buildMarkdown(fm, body), 'utf8')
  }
}

export async function compressHourToDay(
  date: string,
  llmConfig: LLMConfig
): Promise<{ flashbulb: string | null }> {
  const outFile = dayFilePath(date)
  if (existsSync(outFile)) return { flashbulb: null }

  const hourFiles = await getHourFilesForDate(date)
  if (hourFiles.length === 0) return { flashbulb: null }

  const contents: string[] = []
  const sourceIds: string[] = []
  for (const f of hourFiles) {
    const raw = await readFile(f, 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    if (frontmatter.compressed) continue
    contents.push(body)
    sourceIds.push(frontmatter.id)
  }

  if (contents.length === 0) return { flashbulb: null }

  const prompt = DAY_COMPRESS_PROMPT.replace('{content}', contents.join('\n\n---\n\n'))
  const rawSummary = await callLLM(llmConfig, prompt)

  // Extract flashbulb if present
  let flashbulb: string | null = null
  let summary = rawSummary
  const fbMatch = rawSummary.match(/\nFLASHBULB:\s*(.+)$/m)
  if (fbMatch) {
    flashbulb = fbMatch[1].trim()
    summary = rawSummary.replace(fbMatch[0], '').trim()
  }

  const frontmatter: MemoryFrontmatter = {
    id:           date,
    flashbulb:    false,
    compressed:   false,
    sources:      sourceIds,
    compressed_at: new Date().toISOString(),
  }

  await writeFile(outFile, buildMarkdown(frontmatter, summary), 'utf8')

  // Mark hour files as compressed
  for (const f of hourFiles) {
    const raw = await readFile(f, 'utf8')
    const { frontmatter: fm, body } = parseMemoryFile(raw)
    if (sourceIds.includes(fm.id)) {
      fm.compressed = true
      await writeFile(f, buildMarkdown(fm, body), 'utf8')
    }
  }

  return { flashbulb }
}
