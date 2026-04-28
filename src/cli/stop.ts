import { readFileSync, existsSync, unlinkSync } from 'fs'
import { PID_FILE, HEARTBEAT_FILE } from '../storage/paths.js'

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

export function runStop(): void {
  if (!existsSync(PID_FILE)) {
    console.log(JSON.stringify({ success: false, message: 'daemon is not running (no pid file)' }))
    return
  }

  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)

  if (!pid || !isProcessAlive(pid)) {
    try { unlinkSync(PID_FILE) } catch { /* ignore */ }
    try { unlinkSync(HEARTBEAT_FILE) } catch { /* ignore */ }
    console.log(JSON.stringify({ success: true, message: 'daemon was not running, cleaned stale pid file', pid }))
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    console.log(JSON.stringify({ success: false, message: `failed to kill process: ${err}`, pid }))
    return
  }

  let stopped = false
  for (let i = 0; i < 20; i++) {
    const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    void wait
    if (!isProcessAlive(pid)) { stopped = true; break }
  }

  if (!stopped) {
    try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
  }

  try { unlinkSync(PID_FILE) } catch { /* ignore */ }
  try { unlinkSync(HEARTBEAT_FILE) } catch { /* ignore */ }

  console.log(JSON.stringify({ success: true, message: 'daemon stopped', pid }))
}
