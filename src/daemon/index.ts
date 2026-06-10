import { readFileSync, writeFileSync, existsSync, unlinkSync, utimesSync } from 'fs'
import { createInterface } from 'readline'
import { loadBloom } from '../index/bloom.js'
import { ensureDirectories, LOG_FILE, PID_FILE, HEARTBEAT_FILE, setDayBoundary } from '../storage/paths.js'
import { startWatcher, stopWatcher } from './watcher.js'
import { startScheduler, initPartialCompression, runCatchUp } from './scheduler.js'
import { loadConfig } from '../config.js'
import { log } from '../logger.js'
import type { DoraConfig } from '../types.js'

function maskKey(key?: string): string {
  if (!key) return '(not set)'
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

function configSummary(config: DoraConfig): string {
  const llm = config.compression.model
  const lines = [
    `watch_targets=${config.watch.map(w => `${w.format}:${w.path}`).join(', ')}`,
    `llm.provider=${llm.provider}  model=${llm.model_id}  api_key=${maskKey(llm.api_key)}` +
      (llm.base_url ? `  base_url=${llm.base_url}` : ''),
    `session_gap=${config.session_gap_minutes}min  throttle=${config.memory_update_throttle_seconds}s  cold_start=${config.cold_start_days}d`,
  ]
  return lines.join(' | ')
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function acquirePidLock(): void {
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
    if (oldPid && isProcessAlive(oldPid)) {
      log.error('daemon', `Another daemon is already running (pid=${oldPid}). Exiting.`)
      process.exit(1)
    }
    log.warn('daemon', `Stale PID file found (pid=${oldPid}), overwriting.`)
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8')
}

function releasePidLock(): void {
  try { unlinkSync(PID_FILE) } catch { /* ignore */ }
  try { unlinkSync(HEARTBEAT_FILE) } catch { /* ignore */ }
}

function touchHeartbeat(): void {
  const now = new Date()
  try {
    if (!existsSync(HEARTBEAT_FILE)) writeFileSync(HEARTBEAT_FILE, '', 'utf8')
    utimesSync(HEARTBEAT_FILE, now, now)
  } catch { /* ignore */ }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let reportingFatal = false

function startHeartbeat(): void {
  touchHeartbeat()
  heartbeatTimer = setInterval(touchHeartbeat, 30_000)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

function shutdown(signal: string): void {
  log.info('daemon', `Received ${signal}, shutting down.`)
  stopHeartbeat()
  releasePidLock()
  process.exit(0)
}

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(/^y(es)?$/i.test(answer.trim()))
    })
  })
}

export async function startDaemon(): Promise<void> {
  const config = await loadConfig()
  setDayBoundary(config.timezone_offset, config.day_boundary_hour)

  await ensureDirectories()

  acquirePidLock()

  process.on('uncaughtException', err => {
    if (reportingFatal) return
    reportingFatal = true
    try {
      log.error('daemon', `Uncaught exception: ${err.stack ?? err}`)
    } finally {
      reportingFatal = false
    }
  })
  process.on('unhandledRejection', reason => {
    if (reportingFatal) return
    reportingFatal = true
    try {
      log.error('daemon', `Unhandled rejection: ${reason}`)
    } finally {
      reportingFatal = false
    }
  })
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGHUP', () => {
    log.info('daemon', 'Received SIGHUP, reloading config...')
    loadConfig().then(newConfig => {
      setDayBoundary(newConfig.timezone_offset, newConfig.day_boundary_hour)
      stopWatcher().then(() => {
        startWatcher(newConfig.watch, newConfig)
        log.info('daemon', `Config reloaded, watching ${newConfig.watch.length} target(s)`)
      })
    }).catch(err => log.error('daemon', `Config reload failed: ${err}`))
  })
  process.on('exit', () => { releasePidLock() })

  await loadBloom()

  log.info('daemon', `Starting doramemory daemon (pid=${process.pid})`)
  log.info('daemon', `Config: ${configSummary(config)}`)
  log.info('daemon', `Log file: ${LOG_FILE}`)

  startHeartbeat()

  const { getUnrolledSessionTokens } = await import('../storage/compressor.js')
  const unrolledTokens = await getUnrolledSessionTokens()
  const rollingThreshold = config.rolling_trigger_threshold ?? 4000

  if (unrolledTokens >= rollingThreshold) {
    const isTTY = process.stdin.isTTY === true
    if (isTTY) {
      const yes = await askYesNo(
        `检测到 ${unrolledTokens} tokens 未滚动的会话记忆，是否先压缩再启动？(y/N) `
      )
      if (yes) {
        process.stderr.write(`正在滚动存量会话数据...\n`)
        await runCatchUp(config)
        process.stderr.write('存量压缩完成。\n')
      } else {
        process.stderr.write('跳过存量压缩，可稍后运行 npx doramemory compress\n')
      }
    } else {
      log.info('daemon', `${unrolledTokens} unrolled tokens detected, compressing in background...`)
      runCatchUp(config).catch(err =>
        log.error('daemon', `Background catch-up failed: ${err}`)
      )
    }
  }

  startWatcher(config.watch, config)
  startScheduler(config)
  initPartialCompression(config)

  log.info('daemon', 'Daemon started successfully.')
}
