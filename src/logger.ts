import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { dirname } from 'path'
import { LOG_FILE } from './storage/paths.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const envLevel = process.env.DORAMEMORY_LOG_LEVEL as Level | undefined
let minLevel: Level = envLevel && envLevel in LEVEL_PRIORITY ? envLevel : 'info'

const DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024
const configuredMaxLogBytes = process.env.DORAMEMORY_MAX_LOG_BYTES
const maxLogBytes = configuredMaxLogBytes ? Number(configuredMaxLogBytes) : DEFAULT_MAX_LOG_BYTES

let stdoutAvailable = true
let stderrAvailable = true
let logDirEnsured = false

process.stdout.on('error', () => { stdoutAvailable = false })
process.stderr.on('error', () => { stderrAvailable = false })

function ts(): string {
  return new Date().toISOString()
}

function ensureLogDir(): void {
  if (logDirEnsured) return
  mkdirSync(dirname(LOG_FILE), { recursive: true })
  logDirEnsured = true
}

function maybeRotateLog(): void {
  if (!Number.isFinite(maxLogBytes) || maxLogBytes <= 0) return

  try {
    if (statSync(LOG_FILE).size < maxLogBytes) return
    const rotated = `${LOG_FILE}.1`
    rmSync(rotated, { force: true })
    renameSync(LOG_FILE, rotated)
  } catch {
    // Missing or temporarily locked log files are fine; append will retry below.
  }
}

function writeConsole(level: Level, line: string): void {
  if (level === 'error') {
    if (!stderrAvailable) return
    try {
      process.stderr.write(line + '\n')
    } catch {
      stderrAvailable = false
    }
    return
  }

  if (!stdoutAvailable) return
  try {
    process.stdout.write(line + '\n')
  } catch {
    stdoutAvailable = false
  }
}

function writeFile(line: string): void {
  try {
    ensureLogDir()
    maybeRotateLog()
    appendFileSync(LOG_FILE, line + '\n')
  } catch {
    try {
      logDirEnsured = false
      ensureLogDir()
      appendFileSync(LOG_FILE, line + '\n')
    } catch { /* give up silently */ }
  }
}

function write(level: Level, tag: string, msg: string): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return

  const line = `${ts()} [${level.toUpperCase().padEnd(5)}] [${tag}] ${msg}`

  writeConsole(level, line)
  writeFile(line)
}

export const log = {
  debug: (tag: string, msg: string) => write('debug', tag, msg),
  info:  (tag: string, msg: string) => write('info',  tag, msg),
  warn:  (tag: string, msg: string) => write('warn',  tag, msg),
  error: (tag: string, msg: string) => write('error', tag, msg),
  setLevel: (level: Level) => { minLevel = level },
}
