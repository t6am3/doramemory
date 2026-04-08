import { readdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS, IDENTITY_FILE } from '../storage/paths.js'
import type { MemoryFrontmatter } from '../types.js'

const DORAMEMORY_START = '<!-- DORAMEMORY:START -->'
const DORAMEMORY_END   = '<!-- DORAMEMORY:END -->'
const PLACEHOLDER      = '{{DORAMEMORY}}'

function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw.trim() }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2].trim(),
  }
}

function formatDate(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  if (dateStr === today) return '今天'
  if (dateStr === yesterday) return '昨天'
  return dateStr
}

async function buildRecentSection(days: number): Promise<string> {
  const lines: string[] = ['### 近期记忆']
  const dir = LAYER_DIRS.day
  const files = await readdir(dir).catch(() => [] as string[])

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const relevant = files
    .filter(f => f.endsWith('.md') && f.slice(0, 10) >= cutoff)
    .sort()
    .reverse()
    .slice(0, days)

  if (relevant.length === 0) return ''

  for (const f of relevant) {
    const raw = await readFile(join(dir, f), 'utf8')
    const { body } = parseMemoryFile(raw)
    const date = f.replace('.md', '')
    lines.push(`\n=== ${formatDate(date)} ===\n${body}`)
  }

  return lines.join('\n')
}

async function buildFlashbulbSection(): Promise<string> {
  const dir = join(LAYER_DIRS.core, 'recent')
  if (!existsSync(dir)) return ''
  const files = await readdir(dir).catch(() => [] as string[])
  if (files.length === 0) return ''

  const lines = ['### 重要记忆']
  for (const f of files.sort()) {
    const raw = await readFile(join(dir, f), 'utf8')
    const { body } = parseMemoryFile(raw)
    lines.push(body.split('\n')[0])  // first line only
  }
  return lines.join('\n')
}

async function buildIdentitySection(): Promise<string> {
  if (!existsSync(IDENTITY_FILE)) return ''
  const raw = await readFile(IDENTITY_FILE, 'utf8')
  return `### 我是谁\n${raw.trim()}`
}

export async function buildMemoryBlock(days = 5): Promise<string> {
  const sections = await Promise.all([
    buildIdentitySection(),
    buildFlashbulbSection(),
    buildRecentSection(days),
  ])

  const body = sections.filter(Boolean).join('\n\n')
  if (!body.trim()) return ''

  return `${DORAMEMORY_START}\n${body}\n${DORAMEMORY_END}`
}

export async function updateMemoryFile(memoryFilePath: string): Promise<void> {
  const block = await buildMemoryBlock()
  if (!block) return

  if (!existsSync(memoryFilePath)) return  // file doesn't exist, skip silently

  const content = await readFile(memoryFilePath, 'utf8')

  let updated: string

  // Replace existing DORAMEMORY block
  if (content.includes(DORAMEMORY_START)) {
    updated = content.replace(
      new RegExp(`${DORAMEMORY_START}[\\s\\S]*?${DORAMEMORY_END}`),
      block
    )
  } else if (content.includes(PLACEHOLDER)) {
    // Replace placeholder
    updated = content.replace(PLACEHOLDER, block)
  } else {
    // Placeholder not found — warn but don't modify
    process.stderr.write(
      `[doramemory] Warning: ${PLACEHOLDER} not found in ${memoryFilePath}. ` +
      `Add {{DORAMEMORY}} to your memory file to enable injection.\n`
    )
    return
  }

  await writeFile(memoryFilePath, updated, 'utf8')
}
