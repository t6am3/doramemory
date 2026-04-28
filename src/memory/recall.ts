import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { LAYER_DIRS } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'
import { loadIndex, extractSnippet } from './search-index.js'
import type { MemoryChunk, MemoryLayer, RecallRequest } from '../types.js'

function extractSummary(body: string): string {
  const firstLine = body.split('\n').find(l => l.trim().length > 0) ?? ''
  return firstLine.replace(/^#+\s*/, '').slice(0, 200)
}

async function timeQuery(req: RecallRequest): Promise<MemoryChunk[]> {
  if (!req.time_range) return []
  const { from } = req.time_range

  let layer: MemoryLayer
  if (/^\d{4}-\d{2}-\d{2}T/.test(from)) layer = 'second'
  else layer = 'session'

  const dir = LAYER_DIRS[layer]
  const files = await readdir(dir).catch(() => [] as string[])
  const matching = files.filter(f => f.startsWith(from) && f.endsWith('.md'))

  const results: MemoryChunk[] = []
  for (const f of matching) {
    const filePath = join(dir, f)
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    results.push({
      layer,
      id: frontmatter.id ?? f.replace('.md', ''),
      summary: extractSummary(body),
      snippet: body.slice(0, 100).replace(/\n/g, ' '),
      file_path: filePath,
      size: raw.length,
      flashbulb: frontmatter.flashbulb ?? false,
      match_type: 'time',
      score: 1,
    })
  }
  return results
}

export interface RecallResult {
  chunks: MemoryChunk[]
  total_candidates: number
  has_more: boolean
}

export async function recall(req: RecallRequest): Promise<RecallResult> {
  const maxResults = req.max_results ?? 10
  const offset = req.offset ?? 0

  if (req.time_range) {
    const candidates = await timeQuery(req)
    const paged = candidates.slice(offset, offset + maxResults)
    return {
      chunks: paged,
      total_candidates: candidates.length,
      has_more: offset + maxResults < candidates.length,
    }
  }

  if (!req.query) {
    return { chunks: [], total_candidates: 0, has_more: false }
  }

  const idx = await loadIndex()
  const results = idx.search(req.query)

  const chunks: MemoryChunk[] = results.map(r => ({
    layer: (r as any).layer ?? 'session',
    id: r.id.replace(/^(session|rolling):/, ''),
    summary: (r as any).summary ?? '',
    snippet: extractSnippet((r as any).body ?? '', req.query!, 50),
    file_path: (r as any).file_path ?? '',
    size: (r as any).size ?? 0,
    flashbulb: (r as any).flashbulb ?? false,
    match_type: 'keyword' as const,
    score: r.score,
  }))

  const paged = chunks.slice(offset, offset + maxResults)
  return {
    chunks: paged,
    total_candidates: chunks.length,
    has_more: offset + maxResults < chunks.length,
  }
}
