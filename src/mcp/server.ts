import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { recall } from '../memory/recall.js'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS } from '../storage/paths.js'
import { loadBloom } from '../index/bloom.js'
import { ensureDirectories } from '../storage/paths.js'
import type { MemoryFrontmatter } from '../types.js'

function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw.trim() }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2].trim(),
  }
}

export async function startMcpServer(): Promise<void> {
  await ensureDirectories()
  await loadBloom()

  const server = new McpServer({
    name:    'doramemory',
    version: '0.1.0',
  })

  server.tool(
    'memory_recall',
    'Search your memory. Use query for semantic search, or time_range for time-based lookup.',
    {
      query:      z.string().optional().describe('Keywords or semantic query'),
      time_range: z.object({
        from: z.string().describe('e.g. "2026-04-07", "2026-W14", "2026-04"'),
        to:   z.string().optional(),
      }).optional(),
      max_tokens: z.number().optional().default(800),
    },
    async ({ query, time_range, max_tokens }) => {
      const chunks = await recall({ query, time_range, max_tokens })
      if (chunks.length === 0) {
        return { content: [{ type: 'text', text: '没有找到相关记忆。' }] }
      }
      const text = chunks
        .map(c => `[${c.layer} · ${c.time_range.from} · ${c.match_type}]\n${c.content}`)
        .join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'memory_remember',
    'Mark a memory as important (flashbulb) or correct a summary.',
    {
      memory_id:  z.string().describe('The id from a memory_recall result'),
      layer:      z.enum(['second', 'minute', 'hour', 'day', 'week', 'month', 'year']),
      flashbulb:  z.boolean().optional().describe('Mark as permanent memory'),
      content:    z.string().optional().describe('Corrected content (only for day and above)'),
    },
    async ({ memory_id, layer, flashbulb, content }) => {
      const layerDir = LAYER_DIRS[layer]
      const files = await import('fs/promises').then(m => m.readdir(layerDir).catch(() => [] as string[]))
      const file  = files.find(f => f.includes(memory_id))
      if (!file) return { content: [{ type: 'text', text: `Memory ${memory_id} not found.` }] }

      const filePath = join(layerDir, file)
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = parseMemoryFile(raw)

      if (content && ['second', 'minute', 'hour'].includes(layer)) {
        return { content: [{ type: 'text', text: 'Raw layer content cannot be edited.' }] }
      }

      if (flashbulb !== undefined) frontmatter.flashbulb = flashbulb
      const newBody = content ?? body

      await writeFile(
        filePath,
        `---\n${yaml.dump(frontmatter)}---\n\n${newBody}\n`,
        'utf8'
      )
      return { content: [{ type: 'text', text: `Updated ${memory_id}.` }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
