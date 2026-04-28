// Core message types
export type MessageRole = 'user' | 'assistant' | 'tool'

export interface RawMessage {
  message_id: string
  session_id: string
  role: MessageRole
  content: string
  timestamp: string  // ISO 8601
}

export interface SecondEntry {
  id: string
  session_id: string
  role: MessageRole
  timestamp: string
  content: string
  flashbulb: boolean
  truncated?: boolean
  project?: string
}

// File frontmatter for all layers
export interface MemoryFrontmatter {
  id: string
  session_id?: string
  timestamp?: string
  title?: string
  flashbulb: boolean
  compressed: boolean
  sources: string[]
  compressed_at?: string
  project?: string
}

// Session metadata stored in sessions/{id}.yaml
export interface SessionMeta {
  session_id: string
  source_file: string
  started_at: string
  last_active_at: string
  message_count: number
  compressed_to: 'second' | 'session' | null
}

// Memory layers
export type MemoryLayer = 'second' | 'session' | 'core'

// A chunk returned by recall
export interface MemoryChunk {
  layer: string
  id: string
  summary: string
  snippet: string
  file_path: string
  size: number
  flashbulb: boolean
  match_type: 'keyword' | 'semantic' | 'time'
  score: number
}

// Recall request
export interface RecallRequest {
  query?: string
  time_range?: { from: string; to?: string }
  max_tokens?: number
  max_results?: number
  offset?: number
}

// Ingest request
export interface IngestRequest {
  session_id: string
  messages: RawMessage[]
}

// LLM provider config
export type LLMProvider = 'anthropic' | 'oai-completion' | 'oai-response'

export interface LLMConfig {
  provider: LLMProvider
  model_id: string
  api_key?: string
  base_url?: string
}

// Layer budget config
export interface LayerBudget {
  max_tokens: number
  max_entries: number
  max_tokens_per_entry: number
}

export type RollingFile = 'recent' | 'distant' | 'lifetime' | 'identity'

export interface RollingBudgetConfig {
  recent:   { max_tokens: number }
  distant:  { max_tokens: number }
  lifetime: { max_tokens: number }
  identity: { max_tokens: number }
}

export interface MemoryBudgetConfig {
  identity:  { max_tokens: number }
  flashbulb: LayerBudget
  session:   LayerBudget
  rolling:   RollingBudgetConfig
}

// compress_as tool types (used by agentic compression)
export interface CompressAsInput {
  layer: 'session'
  id: string
  title: string
  content: string
  flashbulb?: boolean
}

export interface CompressAsOutput {
  success: boolean
  tokens_used: number
  tokens_limit: number
  error?: string
}

// Full config
export type WatchFormat = 'claude' | 'openclaw' | 'openai'

export interface WatchTarget {
  path: string
  format: WatchFormat
  memory_file: string
  project?: string
}

export interface DoraConfig {
  watch: WatchTarget[]
  compression: {
    model: LLMConfig
  }
  memory_budget: MemoryBudgetConfig
  cold_start_days: number
  session_gap_minutes: number
  memory_update_throttle_seconds: number
  session_compress_threshold?: number
  rolling_trigger_threshold?: number
  timezone_offset: number
  day_boundary_hour: number
}
