import chokidar from 'chokidar'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createInterface } from 'readline'
import { readCursor, writeCursor } from '../index/cursors.js'
import { parseClaudeLine, deriveSessionId } from '../parsers/claude.js'
import { writeMessages } from '../storage/writer.js'
import type { WatchTarget } from '../types.js'

async function processFile(filePath: string, format: WatchTarget['format']): Promise<void> {
  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat) return

  const cursor = await readCursor(filePath)
  if (cursor >= fileStat.size) return  // nothing new

  const sessionId = deriveSessionId(filePath)
  const messages: ReturnType<typeof parseClaudeLine>[] = []

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, {
      start:    cursor,
      encoding: 'utf8',
    })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let lineIndex = 0

    rl.on('line', line => {
      if (!line.trim()) return
      if (format === 'claude') {
        const msg = parseClaudeLine(line, sessionId, lineIndex++)
        if (msg) messages.push(msg)
      }
    })
    rl.on('close', resolve)
    rl.on('error', reject)
  })

  const validMessages = messages.filter((m): m is NonNullable<typeof m> => m !== null)
  if (validMessages.length > 0) {
    await writeMessages(validMessages, filePath)
  }

  await writeCursor(filePath, fileStat.size)
}

export function startWatcher(targets: WatchTarget[]): void {
  for (const target of targets) {
    const watcher = chokidar.watch(target.path, {
      persistent:    true,
      ignoreInitial: false,
      usePolling:    false,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    })

    watcher.on('add',    path => processFile(path, target.format).catch(console.error))
    watcher.on('change', path => processFile(path, target.format).catch(console.error))
    watcher.on('error',  err => console.error('[watcher]', err))

    console.log(`[watcher] Watching ${target.path} (format: ${target.format})`)
  }
}
