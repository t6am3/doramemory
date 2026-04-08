import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { SESSIONS_DIR } from './paths.js'
import type { SessionMeta } from '../types.js'

function sessionPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.yaml`)
}

export async function loadSession(sessionId: string): Promise<SessionMeta | null> {
  const p = sessionPath(sessionId)
  if (!existsSync(p)) return null
  const raw = await readFile(p, 'utf8')
  return yaml.load(raw) as SessionMeta
}

export async function saveSession(meta: SessionMeta): Promise<void> {
  await writeFile(sessionPath(meta.session_id), yaml.dump(meta), 'utf8')
}

export async function touchSession(
  sessionId: string,
  sourceFile: string,
  timestamp: string
): Promise<void> {
  const existing = await loadSession(sessionId)
  if (existing) {
    existing.last_active_at = timestamp
    existing.message_count++
    await saveSession(existing)
  } else {
    await saveSession({
      session_id:     sessionId,
      source_file:    sourceFile,
      started_at:     timestamp,
      last_active_at: timestamp,
      message_count:  1,
      compressed_to:  null,
    })
  }
}
