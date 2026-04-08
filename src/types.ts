// Core message types
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface RawMessage {
  message_id: string
  session_id: string
  role: MessageRole
  content: string
  timestamp: string  // ISO 8601
}

// File frontmatter for all layers
export interface MemoryFrontmatter {
  id: string
  session_id?: string
  timestamp?: string
  flashbulb: boolean
  compressed: boolean
  sources: string[]    // IDs of source files from layer below
  compressed_at?: string
}

// Session metadata stored in sessions/{id}.yaml
export interface SessionMeta {
  session_id: string
  source_file: string
  started_at: string
  last_active_at: string
  message_count: number
  compressed_to: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | null
}

// Memory layers
export type MemoryLayer = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | 'core'

// A chunk returned by recall
export interface MemoryChunk {
  content: string
  layer: MemoryLayer
  time_range: { from: string; to: string }
  sources: string[]
  match_type: 'keyword' | 'semantic' | 'time'
  flashbulb: boolean
}

// Recall request
export interface RecallRequest {
  query?: string
  time_range?: { from: string; to?: string }
  max_tokens?: number
}

// Ingest request
export interface IngestRequest {
  session_id: string
  messages: RawMessage[]
}

// LLM provider config
export type LLMProvider = 'anthropic' | 'openai' | 'custom'

export interface LLMConfig {
  provider: LLMProvider
  model_id: string
  api_key?: string
  base_url?: string
}

// Full config
export interface WatchTarget {
  path: string
  format: 'claude' | 'openai'
  memory_file: string
}

export interface DoraConfig {
  watch: WatchTarget[]
  compression: {
    model: LLMConfig
  }
  cold_start_days: number
  session_gap_minutes: number
  memory_update_throttle_seconds: number
}
