import { writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import yaml from 'js-yaml'
import { hasMessageId, addMessageId, saveBloom } from '../index/bloom.js'
import { secondFilePath } from './paths.js'
import { touchSession } from './sessions.js'
import type { RawMessage, MemoryFrontmatter } from '../types.js'

const MAX_CONTENT_TOKENS = 4000  // ~16k chars, rough estimate
const CHARS_PER_TOKEN = 4

function isOversized(content: string): boolean {
  return content.length > MAX_CONTENT_TOKENS * CHARS_PER_TOKEN
}

function buildMarkdown(frontmatter: MemoryFrontmatter, content: string): string {
  return `---\n${yaml.dump(frontmatter)}---\n\n${content}\n`
}

export interface WriteResult {
  written: number
  skipped: number
}

export async function writeMessages(
  messages: RawMessage[],
  sourceFile: string
): Promise<WriteResult> {
  let written = 0
  let skipped = 0

  for (const msg of messages) {
    if (hasMessageId(msg.message_id)) {
      skipped++
      continue
    }

    const filePath = secondFilePath(msg.timestamp, msg.message_id)
    if (existsSync(filePath)) {
      skipped++
      continue
    }

    let content = msg.content
    let truncated = false

    if (isOversized(content)) {
      const maxChars = MAX_CONTENT_TOKENS * CHARS_PER_TOKEN
      content = content.slice(0, maxChars) + '\n\n[truncated]'
      truncated = true
    }

    const frontmatter: MemoryFrontmatter & { truncated?: boolean } = {
      id:         msg.message_id,
      session_id: msg.session_id,
      timestamp:  msg.timestamp,
      flashbulb:  false,
      compressed: false,
      sources:    [],
      ...(truncated && { truncated: true }),
    }

    await writeFile(filePath, buildMarkdown(frontmatter, `[${msg.role}]\n\n${content}`), 'utf8')
    addMessageId(msg.message_id)
    await touchSession(msg.session_id, sourceFile, msg.timestamp)
    written++
  }

  if (written > 0) await saveBloom()
  return { written, skipped }
}
