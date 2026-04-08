import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS } from '../storage/paths.js'
import type { MemoryChunk, MemoryFrontmatter, MemoryLayer, RecallRequest } from '../types.js'

const RAW_LAYERS:     MemoryLayer[] = ['second', 'hour']
const SUMMARY_LAYERS: MemoryLayer[] = ['day', 'week', 'month', 'year']

function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw.trim() }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2].trim(),
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Keyword grep across a layer directory
async function grepLayer(
  layer: MemoryLayer,
  query: string,
  maxResults = 5
): Promise<MemoryChunk[]> {
  const dir = LAYER_DIRS[layer]
  const files = await readdir(dir).catch(() => [] as string[])
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: MemoryChunk[] = []

  for (const f of files.sort().reverse()) {
    if (!f.endsWith('.md')) continue
    const raw = await readFile(join(dir, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    const bodyLower = body.toLowerCase()
    if (terms.every(t => bodyLower.includes(t))) {
      results.push({
        content:    body,
        layer,
        time_range: { from: frontmatter.id, to: frontmatter.id },
        sources:    frontmatter.sources ?? [],
        match_type: 'keyword',
        flashbulb:  frontmatter.flashbulb ?? false,
      })
      if (results.length >= maxResults) break
    }
  }
  return results
}

// Time range query — return the file matching the given time granularity
async function timeQuery(req: RecallRequest): Promise<MemoryChunk[]> {
  if (!req.time_range) return []
  const { from } = req.time_range

  // Determine layer from the format of `from`
  let layer: MemoryLayer
  if (/^\d{4}-\d{2}-\d{2}T/.test(from))     layer = 'second'
  else if (/^\d{4}-\d{2}-\d{2}$/.test(from)) layer = 'day'
  else if (/^\d{4}-W\d{2}$/.test(from))      layer = 'week'
  else if (/^\d{4}-\d{2}$/.test(from))       layer = 'month'
  else if (/^\d{4}$/.test(from))             layer = 'year'
  else layer = 'day'

  const dir = LAYER_DIRS[layer]
  const files = await readdir(dir).catch(() => [] as string[])
  const matching = files.filter(f => f.startsWith(from) && f.endsWith('.md'))

  const results: MemoryChunk[] = []
  for (const f of matching) {
    const raw = await readFile(join(dir, f), 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)
    results.push({
      content:    body,
      layer,
      time_range: { from: frontmatter.id, to: frontmatter.id },
      sources:    frontmatter.sources ?? [],
      match_type: 'time',
      flashbulb:  frontmatter.flashbulb ?? false,
    })
  }
  return results
}

export async function recall(req: RecallRequest): Promise<MemoryChunk[]> {
  const maxTokens = req.max_tokens ?? 1000
  const chunks: MemoryChunk[] = []

  if (req.time_range) {
    chunks.push(...await timeQuery(req))
  } else if (req.query) {
    // Grep raw layers, then summary layers
    for (const layer of [...RAW_LAYERS, ...SUMMARY_LAYERS]) {
      const results = await grepLayer(layer, req.query)
      chunks.push(...results)
    }
  }

  // Trim to token budget, most recent first
  const selected: MemoryChunk[] = []
  let usedTokens = 0
  for (const chunk of chunks) {
    const t = estimateTokens(chunk.content)
    if (usedTokens + t > maxTokens) break
    selected.push(chunk)
    usedTokens += t
  }

  return selected
}
