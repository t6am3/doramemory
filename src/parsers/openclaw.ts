import { createHash } from 'crypto'
import type { RawMessage, MessageRole } from '../types.js'

// OpenClaw JSONL format — each line has a `type` field.
// We only care about type:"message" lines.
interface OpenClawLine {
  type: string
  id: string
  parentId?: string | null
  timestamp: string
  message?: {
    role: 'user' | 'assistant' | 'toolResult'
    content: OpenClawContentBlock[]
    timestamp?: number
  }
}

interface OpenClawContentBlock {
  type: 'text' | 'toolCall' | 'toolResult'
  text?: string
  name?: string
  toolName?: string
  arguments?: unknown
  content?: OpenClawContentBlock[]
}

function extractText(blocks: OpenClawContentBlock[]): string {
  return blocks
    .map(block => {
      if (block.type === 'text') return block.text ?? ''
      if (block.type === 'toolCall') return `[tool: ${block.name}]`
      if (block.type === 'toolResult' && block.content) return extractText(block.content)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function mapRole(role: string): MessageRole | null {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'toolResult') return 'tool'
  return null
}

export function parseOpenClawLine(
  line: string,
  sessionId: string,
  _index: number,
): RawMessage | null {
  let parsed: OpenClawLine
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  // Only process message lines
  if (parsed.type !== 'message' || !parsed.message) return null

  const role = mapRole(parsed.message.role)
  if (!role) return null

  const content = extractText(parsed.message.content)
  if (!content.trim()) return null

  const timestamp = parsed.timestamp ?? new Date().toISOString()

  return {
    message_id: parsed.id,
    session_id: sessionId,
    role,
    content,
    timestamp,
  }
}

export function deriveSessionId(filePath: string): string {
  // OpenClaw filenames are already UUIDs, use first 8 chars
  const fileName = filePath.split('/').pop() ?? ''
  const uuid = fileName.replace('.jsonl', '')
  if (uuid.match(/^[0-9a-f-]{36}$/)) return uuid.slice(0, 8)
  return createHash('sha256').update(filePath).digest('hex').slice(0, 8)
}
