import MiniSearch from 'minisearch'
import { readdir, readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { LAYER_DIRS, DORA_HOME, ROLLING_FILES } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'
import type { RollingFile } from '../types.js'

const INDEX_FILE = join(DORA_HOME, 'search-index.json')

const MINISEARCH_OPTIONS = {
  fields: ['body'],
  storeFields: ['body', 'layer', 'summary', 'flashbulb', 'sources', 'file_path', 'size'],
  tokenize: (text: string) => {
    const cjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, m => ` ${m} `)
    return cjk.split(/[\s\p{P}]+/u).filter(t => t.length > 0)
  },
  searchOptions: {
    tokenize: (text: string) => {
      const cjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, m => ` ${m} `)
      return cjk.split(/[\s\p{P}]+/u).filter(t => t.length > 0)
    },
    prefix: true,
    fuzzy: 0.2,
  },
}

export interface IndexedDoc {
  id: string
  body: string
  layer: string
  summary: string
  flashbulb: boolean
  sources: string
  file_path: string
  size: number
}

function extractSummary(body: string): string {
  const firstLine = body.split('\n').find(l => l.trim().length > 0) ?? ''
  return firstLine.replace(/^#+\s*/, '').slice(0, 200)
}

async function collectSessionDocs(): Promise<IndexedDoc[]> {
  const dir = LAYER_DIRS.session
  const files = await readdir(dir).catch(() => [] as string[])
  const docs: IndexedDoc[] = []
  for (const f of files) {
    if (!f.endsWith('.md')) continue
    const filePath = join(dir, f)
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    docs.push({
      id: `session:${frontmatter.id ?? f.replace('.md', '')}`,
      body,
      layer: 'session',
      summary: frontmatter.title || extractSummary(body),
      flashbulb: frontmatter.flashbulb ?? false,
      sources: JSON.stringify(frontmatter.sources ?? []),
      file_path: filePath,
      size: raw.length,
    })
  }
  return docs
}

async function collectRollingDocs(): Promise<IndexedDoc[]> {
  const docs: IndexedDoc[] = []
  for (const [name, filePath] of Object.entries(ROLLING_FILES) as [RollingFile, string][]) {
    if (!existsSync(filePath)) continue
    const raw = await readFile(filePath, 'utf8')
    const body = raw.trim()
    if (!body) continue
    docs.push({
      id: `rolling:${name}`,
      body,
      layer: name,
      summary: `rolling/${name}`,
      flashbulb: false,
      sources: '[]',
      file_path: filePath,
      size: raw.length,
    })
  }
  return docs
}

let _index: MiniSearch<IndexedDoc> | null = null

function createIndex(): MiniSearch<IndexedDoc> {
  return new MiniSearch<IndexedDoc>(MINISEARCH_OPTIONS as any)
}

export async function loadIndex(): Promise<MiniSearch<IndexedDoc>> {
  if (_index) return _index
  if (existsSync(INDEX_FILE)) {
    const json = await readFile(INDEX_FILE, 'utf8')
    _index = MiniSearch.loadJSON<IndexedDoc>(json, MINISEARCH_OPTIONS as any)
    return _index
  }
  _index = await rebuildIndex()
  return _index
}

export async function rebuildIndex(): Promise<MiniSearch<IndexedDoc>> {
  const idx = createIndex()
  const [sessionDocs, rollingDocs] = await Promise.all([
    collectSessionDocs(),
    collectRollingDocs(),
  ])
  idx.addAll([...sessionDocs, ...rollingDocs])
  _index = idx
  await saveIndex()
  return idx
}

export async function saveIndex(): Promise<void> {
  if (!_index) return
  await mkdir(dirname(INDEX_FILE), { recursive: true })
  await writeFile(INDEX_FILE, JSON.stringify(_index), 'utf8')
}

export async function addToIndex(doc: IndexedDoc): Promise<void> {
  const idx = await loadIndex()
  try { idx.discard(doc.id) } catch { /* not found, ok */ }
  idx.add(doc)
  await saveIndex()
}

export function extractSnippet(body: string, query: string, windowSize = 50): string {
  const bodyLower = body.toLowerCase()
  const terms = query.toLowerCase().split(/[\s\p{P}]+/u).filter(t => t.length > 0)
  let bestPos = -1
  let bestTerm = ''
  for (const term of terms) {
    const pos = bodyLower.indexOf(term)
    if (pos !== -1) { bestPos = pos; bestTerm = term; break }
  }
  if (bestPos === -1) return body.slice(0, windowSize * 2).replace(/\n/g, ' ')

  const start = Math.max(0, bestPos - windowSize)
  const end = Math.min(body.length, bestPos + bestTerm.length + windowSize)
  let raw = body.slice(start, end).replace(/\n/g, ' ')
  if (start > 0) raw = '...' + raw
  if (end < body.length) raw = raw + '...'

  const highlighted = raw.replace(
    new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'),
    '«$1»'
  )
  return highlighted
}
