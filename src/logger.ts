import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { LOG_FILE } from './storage/paths.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
let minLevel: Level = (process.env.DORAMEMORY_LOG_LEVEL as Level) ?? 'info'

function ts(): string {
  return new Date().toISOString()
}

function write(level: Level, tag: string, msg: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return

  const line = `${ts()} [${level.toUpperCase().padEnd(5)}] [${tag}] ${msg}`

  if (level === 'error') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }

  try {
    appendFileSync(LOG_FILE, line + '\n')
  } catch {
    try {
      mkdirSync(dirname(LOG_FILE), { recursive: true })
      appendFileSync(LOG_FILE, line + '\n')
    } catch { /* give up silently */ }
  }
}

export const log = {
  debug: (tag: string, msg: string) => write('debug', tag, msg),
  info:  (tag: string, msg: string) => write('info',  tag, msg),
  warn:  (tag: string, msg: string) => write('warn',  tag, msg),
  error: (tag: string, msg: string) => write('error', tag, msg),
  setLevel: (level: Level) => { minLevel = level },
}
