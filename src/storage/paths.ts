import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import type { MemoryLayer } from '../types.js'

export const DORA_HOME = join(homedir(), '.doramemory')

export const LAYER_DIRS: Record<MemoryLayer | 'core_recent', string> = {
  second:      join(DORA_HOME, 'second'),
  minute:      join(DORA_HOME, 'minute'),
  hour:        join(DORA_HOME, 'hour'),
  day:         join(DORA_HOME, 'day'),
  week:        join(DORA_HOME, 'week'),
  month:       join(DORA_HOME, 'month'),
  year:        join(DORA_HOME, 'year'),
  core:        join(DORA_HOME, 'core'),
  core_recent: join(DORA_HOME, 'core', 'recent'),
}

export const SESSIONS_DIR   = join(DORA_HOME, 'sessions')
export const INDEX_DIR      = join(DORA_HOME, 'index')
export const CURSORS_DIR    = join(DORA_HOME, 'index', 'cursors')
export const BLOOM_FILE     = join(DORA_HOME, 'index', 'message_ids.bloom')
export const EMBEDDINGS_DB  = join(DORA_HOME, 'index', 'embeddings.db')
export const IDENTITY_FILE  = join(DORA_HOME, 'core', 'identity.md')
export const CONFIG_FILE    = join(DORA_HOME, 'config.yaml')
export const ERRORS_LOG     = join(DORA_HOME, 'errors.log')

export async function ensureDirectories(): Promise<void> {
  const dirs = [
    ...Object.values(LAYER_DIRS),
    SESSIONS_DIR,
    INDEX_DIR,
    CURSORS_DIR,
  ]
  await Promise.all(dirs.map(d => mkdir(d, { recursive: true })))
}

// second/2026-04-07T14:30:22-{msgId}.md
export function secondFilePath(timestamp: string, messageId: string): string {
  const safe = timestamp.replace(/[:.]/g, '-')
  return join(LAYER_DIRS.second, `${safe}-${messageId}.md`)
}

// hour/2026-04-07-14.md
export function hourFilePath(timestamp: string): string {
  const d = new Date(timestamp)
  const date = d.toISOString().slice(0, 10)
  const hour = String(d.getUTCHours()).padStart(2, '0')
  return join(LAYER_DIRS.hour, `${date}-${hour}.md`)
}

// day/2026-04-07.md
export function dayFilePath(date: string): string {
  return join(LAYER_DIRS.day, `${date}.md`)
}
