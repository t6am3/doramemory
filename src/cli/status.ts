import { readFileSync, statSync, existsSync } from 'fs'
import { PID_FILE, HEARTBEAT_FILE, LOG_FILE } from '../storage/paths.js'
import yaml from 'js-yaml'

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function timeAgo(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ${min % 60}m ago`
  const day = Math.floor(hr / 24)
  return `${day}d ${hr % 24}h ago`
}

export function runStatus(): void {
  const status: Record<string, unknown> = {}

  if (!existsSync(PID_FILE)) {
    status.daemon = { running: false, reason: 'no_pid_file' }
  } else {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (isProcessAlive(pid)) {
      status.daemon = { running: true, pid }
    } else {
      status.daemon = { running: false, pid, reason: 'stale' }
    }
  }

  if (existsSync(HEARTBEAT_FILE)) {
    const mtime = statSync(HEARTBEAT_FILE).mtimeMs
    const agoMs = Date.now() - mtime
    status.heartbeat = { last: new Date(mtime).toISOString(), ago: timeAgo(agoMs), healthy: agoMs < 90_000 }
  } else {
    status.heartbeat = null
  }

  status.log_file = LOG_FILE

  console.log(JSON.stringify(status, null, 2))
}
