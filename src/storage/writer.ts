import { appendFile } from 'fs/promises'
import { hasMessageId, addMessageId, saveBloom } from '../index/bloom.js'
import { secondHourFile } from './paths.js'
import { touchSession } from './sessions.js'
import type { RawMessage, SecondEntry } from '../types.js'

const MAX_CONTENT_TOKENS = 4000
const CHARS_PER_TOKEN = 4

function isOversized(content: string): boolean {
  return content.length > MAX_CONTENT_TOKENS * CHARS_PER_TOKEN
}

export interface WriteResult {
  written: number
  skipped: number
}

export async function writeMessages(
  messages: RawMessage[],
  sourceFile: string,
  project?: string,
): Promise<WriteResult> {
  let written = 0
  let skipped = 0

  for (const msg of messages) {
    if (hasMessageId(msg.message_id)) {
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

    const entry: SecondEntry = {
      id:         msg.message_id,
      session_id: msg.session_id,
      role:       msg.role,
      timestamp:  msg.timestamp,
      content,
      flashbulb:  false,
      ...(truncated && { truncated: true }),
      ...(project && { project }),
    }

    const filePath = secondHourFile(msg.timestamp)
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8')
    addMessageId(msg.message_id)
    await touchSession(msg.session_id, sourceFile, msg.timestamp)
    written++
  }

  if (written > 0) await saveBloom()
  return { written, skipped }
}
