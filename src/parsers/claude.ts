import { createHash } from 'crypto'
import type { RawMessage } from '../types.js'

// Claude Code stores conversations as JSONL
// Each line is a message object with this shape
interface ClaudeMessage {
  uuid?: string
  type?: string
  role?: 'user' | 'assistant'
  content?: string | ClaudeContentBlock[]
  created_at?: string
  timestamp?: string
}

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  name?: string
  input?: unknown
  content?: string | ClaudeContentBlock[]
}

function extractText(content: string | ClaudeContentBlock[] | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .map(block => {
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'tool_use') return `[tool: ${block.name}]`
      if (block.type === 'tool_result') return extractText(block.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function deriveMessageId(msg: ClaudeMessage, sessionId: string, index: number): string {
  if (msg.uuid) return msg.uuid
  const raw = `${sessionId}:${msg.role}:${msg.created_at ?? msg.timestamp ?? index}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export function parseClaudeLine(
  line: string,
  sessionId: string,
  index: number
): RawMessage | null {
  let msg: ClaudeMessage
  try {
    msg = JSON.parse(line)
  } catch {
    return null
  }

  // Skip non-message entries (e.g. metadata lines)
  if (!msg.role || !msg.content) return null

  const content = extractText(msg.content)
  if (!content.trim()) return null

  const timestamp = msg.created_at ?? msg.timestamp ?? new Date().toISOString()
  const role = msg.role === 'assistant' ? 'assistant' : 'user'

  return {
    message_id: deriveMessageId(msg, sessionId, index),
    session_id: sessionId,
    role,
    content,
    timestamp,
  }
}

export function deriveSessionId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 8)
}
