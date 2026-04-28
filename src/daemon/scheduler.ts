import { existsSync } from 'fs'
import { compressSessionPartial, estimateActiveSessionTokens, compressRolling, getUnrolledSessionTokens, getOldestUnrolledSessions } from '../storage/compressor.js'
import { updateMemoryFile, buildMemoryContext } from '../memory/builder.js'
import { toLocalDate } from '../storage/paths.js'
import { log } from '../logger.js'
import type { DoraConfig } from '../types.js'

async function refreshMemory(config: DoraConfig): Promise<void> {
  for (const target of config.watch) {
    await updateMemoryFile(target.memory_file, config.memory_budget, target.project).catch(err =>
      log.error('scheduler', `Memory file refresh failed for ${target.memory_file}: ${err}`)
    )
  }
}

export async function runCatchUp(config: DoraConfig): Promise<void> {
  try {
    const rollingThreshold = config.rolling_trigger_threshold ?? 4000
    const unrolledTokens = await getUnrolledSessionTokens()

    if (unrolledTokens >= rollingThreshold) {
      log.info('scheduler', `Catch-up rolling: ${unrolledTokens} unrolled tokens >= ${rollingThreshold}`)
      await rollOldestSessions(config, rollingThreshold)
    }

    const { rebuildIndex } = await import('../memory/search-index.js')
    await rebuildIndex().catch(e => log.warn('scheduler', `Index rebuild failed: ${e}`))

    await refreshMemory(config)
  } catch (err) {
    log.error('catch-up', `Compression failed: ${err}`)
  }
}

export function startScheduler(_config: DoraConfig): void {
  log.info('scheduler', 'Started — event-driven compression (triggered by new messages)')
}

let compressionRunning = false

export function initPartialCompression(_config: DoraConfig): void {
  compressionRunning = false
  log.info('scheduler', 'Event-driven compression enabled (session threshold + rolling threshold)')
}

async function rollOldestSessions(config: DoraConfig, rollingThreshold: number): Promise<void> {
  const { toRoll } = await getOldestUnrolledSessions(rollingThreshold)
  if (toRoll.length === 0) return

  log.info('scheduler', `Rolling ${toRoll.length} oldest sessions`)

  const combinedContent = toRoll
    .map(s => {
      const prefix = s.flashbulb ? '⭐ ' : ''
      const role = s.project ? ` [your_role: ${s.project}]` : ''
      return `### ${prefix}${s.id}${role}\n${s.body}`
    })
    .join('\n\n---\n\n')

  const dayId = toLocalDate()
  await compressRolling(
    combinedContent,
    dayId,
    config.compression.model,
    config.memory_budget,
    [dayId],
  )

  const { rebuildIndex } = await import('../memory/search-index.js')
  await rebuildIndex().catch(e => log.warn('scheduler', `Index rebuild failed: ${e}`))
}

export async function triggerPartialCompression(config: DoraConfig): Promise<void> {
  if (compressionRunning) return

  const sessionThreshold = config.session_compress_threshold ?? 2000
  const rollingThreshold = config.rolling_trigger_threshold ?? 4000

  try {
    compressionRunning = true

    const sessions = await estimateActiveSessionTokens()
    const ready = sessions.filter(s => s.newTokens + s.partialTokens >= sessionThreshold)

    if (ready.length > 0) {
      const ctx = await buildMemoryContext(config.memory_budget, new Date())
      for (const s of ready) {
        log.info('scheduler', `Session compression triggered [${s.sessionShort}]: ${s.newTokens + s.partialTokens} tokens >= ${sessionThreshold}`)
        await compressSessionPartial(s.sessionShort, config.compression.model, config.memory_budget, ctx)
      }
    }

    const unrolledTokens = await getUnrolledSessionTokens()
    if (unrolledTokens >= rollingThreshold) {
      log.info('scheduler', `Rolling triggered: ${unrolledTokens} unrolled tokens >= ${rollingThreshold}`)
      await rollOldestSessions(config, rollingThreshold)
      await refreshMemory(config)
    } else if (ready.length > 0) {
      await refreshMemory(config)
    }
  } catch (err) {
    log.error('scheduler', `Event-driven compression failed: ${err}`)
  } finally {
    compressionRunning = false
  }
}
