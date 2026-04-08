import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { CURSORS_DIR } from '../storage/paths.js'

function cursorPath(filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  return join(CURSORS_DIR, `${hash}.cursor`)
}

export async function readCursor(filePath: string): Promise<number> {
  const p = cursorPath(filePath)
  if (!existsSync(p)) return 0
  const raw = await readFile(p, 'utf8')
  return parseInt(raw.trim(), 10) || 0
}

export async function writeCursor(filePath: string, offset: number): Promise<void> {
  await writeFile(cursorPath(filePath), String(offset), 'utf8')
}
