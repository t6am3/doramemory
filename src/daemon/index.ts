import { loadBloom } from '../index/bloom.js'
import { ensureDirectories } from '../storage/paths.js'
import { startWatcher } from './watcher.js'
import { startScheduler } from './scheduler.js'
import { loadConfig } from '../config.js'

export async function startDaemon(): Promise<void> {
  const config = await loadConfig()

  await ensureDirectories()
  await loadBloom()

  startWatcher(config.watch)
  startScheduler(config)

  console.log('[doramemory] Daemon started.')

  // Keep process alive
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
}
