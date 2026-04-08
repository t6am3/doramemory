import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS, IDENTITY_FILE } from '../storage/paths.js'
import type { MemoryFrontmatter } from '../types.js'

const DORAMEMORY_START = '<!-- DORAMEMORY:START -->'
const DORAMEMORY_END   = '<!-- DORAMEMORY:END -->'
const PLACEHOLDER      = '{{DORAMEMORY}}'
const TOTAL_BUDGET     = 4000  // tokens
const CHARS_PER_TOKEN  = 4

function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw.trim() }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2].trim(),
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// Truncate to token limit, cutting at last complete sentence
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastBreak = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('\n'),
    cut.lastIndexOf('.')
  )
  return lastBreak > maxChars * 0.5 ? cut.slice(0, lastBreak + 1) : cut
}

// How many tokens to give each memory unit based on its age in hours
function tokenCapForAge(ageHours: number): number {
  if (ageHours < 8)    return 300   // today's hours
  if (ageHours < 72)   return 200   // last 3 days
  if (ageHours < 336)  return 150   // last 2 weeks (14 days)
  if (ageHours < 1440) return 100   // last 2 months (60 days)
  if (ageHours < 8760) return 80    // last year
  return 60                          // older than 1 year
}

// ─────────────────────────────────────────────
// Build a flat list of memory entries from near to far
// Each entry: { label, body, ageHours }
// ─────────────────────────────────────────────

interface MemoryEntry {
  label: string
  body: string
  ageHours: number
}

function formatLabel(id: string, ageHours: number): string {
  if (ageHours < 8)   return `今天 ${id.slice(11, 13)}:00`
  if (ageHours < 24)  return '昨天'
  if (ageHours < 48)  return '前天'
  if (ageHours < 72)  return '大前天'
  if (id.match(/^\d{4}-W/)) return id  // week
  if (id.match(/^\d{4}-\d{2}$/)) {     // month
    const [y, m] = id.split('-')
    return `${y}年${parseInt(m)}月`
  }
  if (id.match(/^\d{4}$/)) return `${id}年`
  return id
}

async function loadLayerEntries(
  dir: string,
  beforeId: string   // only load files with id strictly before this string
): Promise<MemoryEntry[]> {
  const files = await readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  const entries: MemoryEntry[] = []

  for (const f of files.sort().reverse()) {
    if (!f.endsWith('.md')) continue
    const id = f.replace('.md', '')
    if (id >= beforeId) continue  // skip current or future time units

    const raw = await readFile(join(dir, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)

    // Estimate age from id
    let refTime: number
    if (id.match(/^\d{4}-\d{2}-\d{2}-\d{2}$/)) {
      // hour: 2026-04-07-14
      refTime = new Date(`${id.slice(0, 10)}T${id.slice(11, 13)}:00:00Z`).getTime()
    } else if (id.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // day
      refTime = new Date(`${id}T00:00:00Z`).getTime()
    } else if (id.match(/^\d{4}-W\d{2}$/)) {
      // week: approximate as 7 days before end of week
      refTime = now - 14 * 86400000
    } else if (id.match(/^\d{4}-\d{2}$/)) {
      // month
      refTime = new Date(`${id}-01T00:00:00Z`).getTime()
    } else {
      // year
      refTime = new Date(`${id}-01-01T00:00:00Z`).getTime()
    }

    const ageHours = (now - refTime) / 3600000

    entries.push({
      label: formatLabel(id, ageHours),
      body:  body.trim(),
      ageHours,
    })
  }

  return entries
}

async function buildIdentityBlock(): Promise<string> {
  if (!existsSync(IDENTITY_FILE)) return ''
  const raw = await readFile(IDENTITY_FILE, 'utf8')
  return `### 我是谁\n${raw.trim()}`
}

async function buildFlashbulbBlock(): Promise<string> {
  const dir = join(LAYER_DIRS.core, 'recent')
  if (!existsSync(dir)) return ''
  const files = await readdir(dir).catch(() => [] as string[])
  if (files.length === 0) return ''
  const lines = ['### 重要记忆']
  for (const f of files.sort().reverse()) {
    const raw = await readFile(join(dir, f), 'utf8')
    const { body } = parseMemoryFile(raw)
    lines.push(`- ${body.split('\n')[0]}`)
  }
  return lines.join('\n')
}

export async function buildMemoryBlock(): Promise<string> {
  const now = new Date()
  const todayDate  = now.toISOString().slice(0, 10)
  const currentHour = `${todayDate}-${String(now.getUTCHours()).padStart(2, '0')}`
  const currentWeek = (() => {
    const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4))
    const w = Math.ceil(((now.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7)
    return `${now.getUTCFullYear()}-W${String(w).padStart(2, '0')}`
  })()
  const currentMonth = now.toISOString().slice(0, 7)
  const currentYear  = String(now.getUTCFullYear())

  // Fixed sections (not counted against sliding budget)
  const identity  = await buildIdentityBlock()
  const flashbulb = await buildFlashbulbBlock()

  const fixedTokens = estimateTokens(identity) + estimateTokens(flashbulb)
  let available = TOTAL_BUDGET - fixedTokens

  // Collect all entries from near to far
  const allEntries: MemoryEntry[] = [
    ...await loadLayerEntries(LAYER_DIRS.hour,  currentHour),
    ...await loadLayerEntries(LAYER_DIRS.day,   todayDate),
    ...await loadLayerEntries(LAYER_DIRS.week,  currentWeek),
    ...await loadLayerEntries(LAYER_DIRS.month, currentMonth),
    ...await loadLayerEntries(LAYER_DIRS.year,  currentYear),
  ].sort((a, b) => a.ageHours - b.ageHours)  // nearest first

  // Walk from near to far, consume token budget
  const selected: string[] = []
  for (const entry of allEntries) {
    if (available <= 0) break
    const cap     = tokenCapForAge(entry.ageHours)
    const content = truncateToTokens(entry.body, Math.min(cap, available))
    const tokens  = estimateTokens(content)
    selected.push(`=== ${entry.label} ===\n${content}`)
    available -= tokens
  }

  if (selected.length === 0 && !identity && !flashbulb) return ''

  const sections = [identity, flashbulb, selected.join('\n\n')].filter(Boolean)
  const body = sections.join('\n\n')

  return `${DORAMEMORY_START}\n${body}\n${DORAMEMORY_END}`
}

export async function updateMemoryFile(memoryFilePath: string): Promise<void> {
  const block = await buildMemoryBlock()
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
