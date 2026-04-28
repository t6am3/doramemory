import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { recall } from '../memory/recall.js'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS, ensureDirectories } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'
import { loadBloom } from '../index/bloom.js'
import type { MemoryFrontmatter } from '../types.js'

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
      const result = await recall({ query, time_range, max_tokens })
      if (result.chunks.length === 0) {
        return { content: [{ type: 'text', text: '没有找到相关记忆。' }] }
      }
      const text = result.chunks
        .map(c => `[${c.layer} · ${c.id} · ${c.match_type} · score=${c.score.toFixed(2)}]\n${c.summary}\n> ${c.snippet}\n📄 ${c.file_path}`)
        .join('\n\n---\n\n')
      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'memory_remember',
    'Mark a memory as important (flashbulb) or correct a summary.',
    {
      memory_id:  z.string().describe('The id from a memory_recall result'),
      layer:      z.enum(['second', 'session']),
      flashbulb:  z.boolean().optional().describe('Mark as permanent memory'),
      content:    z.string().optional().describe('Corrected content'),
    },
    async ({ memory_id, layer, flashbulb, content }) => {
      const layerDir = LAYER_DIRS[layer]
      const files = await import('fs/promises').then(m => m.readdir(layerDir).catch(() => [] as string[]))
      const file  = files.find(f => f.includes(memory_id))
      if (!file) return { content: [{ type: 'text', text: `Memory ${memory_id} not found.` }] }

      const filePath = join(layerDir, file)
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = parseMemoryFile(raw)

      if (content && layer === 'second') {
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
