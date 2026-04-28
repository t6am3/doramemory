import { homedir } from 'os'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import type { MemoryLayer, RollingFile } from '../types.js'

export const DORA_HOME = process.env.DORAMEMORY_HOME ?? join(homedir(), '.doramemory')

export const LAYER_DIRS: Record<MemoryLayer, string> = {
  second:      join(DORA_HOME, 'second'),
  session:     join(DORA_HOME, 'session'),
  core:        join(DORA_HOME, 'core'),
}

export const LEGACY_DIRS = ['day', 'week', 'month', 'year', 'minute', 'hour', 'second_old'].map(d => join(DORA_HOME, d))

export const SESSIONS_DIR   = join(DORA_HOME, 'sessions')
export const INDEX_DIR      = join(DORA_HOME, 'index')
export const CURSORS_DIR    = join(DORA_HOME, 'index', 'cursors')
export const BLOOM_FILE     = join(DORA_HOME, 'index', 'message_ids.bloom')
export const IDENTITY_FILE  = join(DORA_HOME, 'core', 'identity.md')
export const CONFIG_FILE    = join(DORA_HOME, 'config.yaml')
export const LOG_FILE       = join(DORA_HOME, 'doramemory.log')
export const PID_FILE       = join(DORA_HOME, 'daemon.pid')
export const HEARTBEAT_FILE = join(DORA_HOME, 'daemon.heartbeat')
export const LAST_RUN_FILE  = join(INDEX_DIR, 'last_run.yaml')

export const ROLLING_DIR = join(DORA_HOME, 'rolling')

export const ROLLING_FILES: Record<RollingFile, string> = {
  recent:   join(ROLLING_DIR, 'recent.md'),
  distant:  join(ROLLING_DIR, 'distant.md'),
  lifetime: join(ROLLING_DIR, 'lifetime.md'),
  identity: join(ROLLING_DIR, 'identity.md'),
}

export const SNAPSHOT_DIRS: Record<RollingFile, string> = {
  recent:   join(DORA_HOME, 'snapshots', 'recent'),
  distant:  join(DORA_HOME, 'snapshots', 'distant'),
  lifetime: join(DORA_HOME, 'snapshots', 'lifetime'),
  identity: join(DORA_HOME, 'snapshots', 'identity'),
}

export const TRACES_DIR = join(DORA_HOME, 'traces')

let _utcOffsetHours = 4

export function setDayBoundary(timezoneOffset: number, dayBoundaryHour: number): void {
  _utcOffsetHours = timezoneOffset - dayBoundaryHour
}

export function toLocalDate(d: Date | string = new Date()): string {
  const ms = typeof d === 'string' ? new Date(d).getTime() : d.getTime()
  return new Date(ms + _utcOffsetHours * 3_600_000).toISOString().slice(0, 10)
}

export async function ensureDirectories(): Promise<void> {
  const dirs = [
    LAYER_DIRS.second,
    LAYER_DIRS.session,
    LAYER_DIRS.core,
    SESSIONS_DIR,
    INDEX_DIR,
    CURSORS_DIR,
    ROLLING_DIR,
    ...Object.values(SNAPSHOT_DIRS),
    TRACES_DIR,
  ]
  await Promise.all(dirs.map(d => mkdir(d, { recursive: true })))
}

// second/2026-04-07T14.jsonl  (hourly JSONL file)
export function secondHourFile(timestamp: string): string {
  const ms = new Date(timestamp).getTime()
  const shifted = new Date(ms + _utcOffsetHours * 3_600_000)
  const date = shifted.toISOString().slice(0, 10)
  const hour = String(shifted.getUTCHours()).padStart(2, '0')
  return join(LAYER_DIRS.second, `${date}T${hour}.jsonl`)
}
