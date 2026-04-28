import chokidar, { type FSWatcher } from 'chokidar'
import { readdirSync } from 'fs'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'
import { createInterface } from 'readline'
import { readCursor, writeCursor } from '../index/cursors.js'
import { parseClaudeLine, deriveSessionId as claudeSessionId } from '../parsers/claude.js'
import { parseOpenClawLine, deriveSessionId as openclawSessionId } from '../parsers/openclaw.js'
import { writeMessages } from '../storage/writer.js'
import { triggerPartialCompression } from './scheduler.js'
import { log } from '../logger.js'
import type { DoraConfig, RawMessage, WatchFormat, WatchTarget } from '../types.js'

type LineParseFn = (line: string, sessionId: string, index: number) => RawMessage | null
type SessionIdFn = (filePath: string) => string

export function inferProject(filePath: string, format: WatchFormat): string {
  switch (format) {
    case 'claude': {
      const m = filePath.match(/\.claude\/projects\/[^/]*-([^-/]+)/)
      return m ? `claude-code-${m[1]}` : 'claude-code'
    }
    case 'openclaw': {
      const m = filePath.match(/\.openclaw\/agents\/([^/]+)/)
      return m ? `openclaw-${m[1]}` : 'openclaw'
    }
    case 'openai': {
      return 'openai'
    }
  }
}

function getParser(format: WatchFormat): { parseLine: LineParseFn; deriveSessionId: SessionIdFn } {
  switch (format) {
    case 'claude':
      return { parseLine: parseClaudeLine, deriveSessionId: claudeSessionId }
    case 'openclaw':
      return { parseLine: parseOpenClawLine, deriveSessionId: openclawSessionId }
    case 'openai':
      return { parseLine: parseClaudeLine, deriveSessionId: claudeSessionId }
  }
}

export async function ingestFile(
  filePath: string,
  format: WatchFormat,
  project?: string,
): Promise<{ written: number; skipped: number }> {
  if (!filePath.endsWith('.jsonl')) return { written: 0, skipped: 0 }

  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat) return { written: 0, skipped: 0 }

  const cursor = await readCursor(filePath)
  if (cursor >= fileStat.size) return { written: 0, skipped: 0 }

  const { parseLine, deriveSessionId } = getParser(format)
  const sessionId = deriveSessionId(filePath)
  const messages: RawMessage[] = []

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, {
      start:    cursor,
      encoding: 'utf8',
    })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let lineIndex = 0

    rl.on('line', line => {
      if (!line.trim()) return
      const msg = parseLine(line, sessionId, lineIndex++)
      if (msg) messages.push(msg)
    })
    rl.on('close', resolve)
    rl.on('error', reject)
  })

  let written = 0
  let skipped = 0

  if (messages.length > 0) {
    const resolvedProject = project ?? inferProject(filePath, format)
    const result = await writeMessages(messages, filePath, resolvedProject)
    written = result.written
    skipped = result.skipped
  }

  await writeCursor(filePath, fileStat.size)
  return { written, skipped }
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findJsonlFiles(full))
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(full)
      }
    }
  } catch { /* dir not found */ }
  return results
}

export async function batchIngest(targets: WatchTarget[]): Promise<{ files: number; written: number }> {
  let totalFiles = 0
  let totalWritten = 0

  for (const target of targets) {
    const files = findJsonlFiles(target.path)
    for (const f of files) {
      const { written } = await ingestFile(f, target.format, target.project)
      if (written > 0) {
        totalWritten += written
        log.debug('ingest', `${f}: ${written} new messages`)
      }
      totalFiles++
    }
  }

  return { files: totalFiles, written: totalWritten }
}

async function processFile(filePath: string, format: WatchFormat, config: DoraConfig, project?: string): Promise<void> {
  const { written } = await ingestFile(filePath, format, project)

  if (written > 0) {
    log.info('watcher', `Processed ${filePath}: ${written} written`)
    triggerPartialCompression(config).catch(err =>
      log.error('watcher', `Partial compression trigger error: ${err}`)
    )
  }
}

const activeWatchers: FSWatcher[] = []

export async function stopWatcher(): Promise<void> {
  for (const w of activeWatchers) {
    await w.close()
  }
  activeWatchers.length = 0
}

export function startWatcher(targets: WatchTarget[], config: DoraConfig): void {
  for (const target of targets) {
    const watcher = chokidar.watch(target.path, {
      persistent:    true,
      ignoreInitial: false,
      usePolling:    false,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })

    watcher.on('add',    path => processFile(path, target.format, config, target.project).catch(err => log.error('watcher', `Error processing ${path}: ${err}`)))
    watcher.on('change', path => processFile(path, target.format, config, target.project).catch(err => log.error('watcher', `Error processing ${path}: ${err}`)))
    watcher.on('error',  err => log.error('watcher', `Watcher error: ${err}`))

    activeWatchers.push(watcher)
    log.info('watcher', `Watching ${target.path} (format: ${target.format})`)
  }
}
