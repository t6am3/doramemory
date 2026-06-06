import { readdir, unlink, mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, join } from 'path'
import { loadConfig } from '../config.js'
import {
  compressSecondToSession,
  compressRolling,
  getUnrolledSessionBodies,
  discoverSessionDates,
  discoverSessionsForDate,
} from '../storage/compressor.js'
import { buildMemoryContext } from '../memory/builder.js'
import { LAYER_DIRS, ROLLING_DIR, SNAPSHOT_DIRS, LEGACY_DIRS, TRACES_DIR, ensureDirectories, setDayBoundary } from '../storage/paths.js'
import { batchIngest } from '../daemon/watcher.js'
import { loadBloom } from '../index/bloom.js'
import { log } from '../logger.js'

async function clearLayer(dir: string): Promise<number> {
  const files = await readdir(dir).catch(() => [] as string[])
  let count = 0
  for (const f of files) {
    if (f.endsWith('.md')) {
      await unlink(join(dir, f))
      count++
    }
  }
  return count
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm}m${rs}s`
}

const MAX_CONCURRENCY = 10

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = MAX_CONCURRENCY): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

function progressBar(current: number, total: number, width = 20): string {
  const pct = total === 0 ? 0 : current / total
  const filled = Math.round(pct * width)
  const empty = width - filled
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(pct * 100).toFixed(0)}%`
}

export async function runCompress(args: string[]): Promise<void> {
  const fresh = args.includes('--fresh')
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity

  log.setLevel('info')
  const config = await loadConfig()
  setDayBoundary(config.timezone_offset, config.day_boundary_hour)
  const llm = config.compression.model
  const budget = config.memory_budget

  await mkdir(LAYER_DIRS.session, { recursive: true })

  if (fresh) {
    process.stderr.write('🗑  --fresh: clearing all compression layers...\n')
    for (const layer of ['session'] as const) {
      if (existsSync(LAYER_DIRS[layer])) {
        const count = await clearLayer(LAYER_DIRS[layer])
        if (count > 0) process.stderr.write(`   Removed ${count} files from ${layer}/\n`)
      }
    }
    if (existsSync(ROLLING_DIR)) {
      await rm(ROLLING_DIR, { recursive: true })
      process.stderr.write(`   Cleared rolling/\n`)
    }
    if (existsSync(TRACES_DIR)) {
      await rm(TRACES_DIR, { recursive: true })
      process.stderr.write(`   Cleared traces/\n`)
    }
    for (const [name, dir] of Object.entries(SNAPSHOT_DIRS)) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true })
        process.stderr.write(`   Cleared snapshots/${name}/\n`)
      }
    }
    for (const dir of LEGACY_DIRS) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true })
        process.stderr.write(`   Removed legacy ${basename(dir)}/\n`)
      }
    }
  }

  await ensureDirectories()
  await loadBloom()

  process.stderr.write('\n📥 Ingesting...\n')
  const ingestResult = await batchIngest(config.watch)
  process.stderr.write(`   ${ingestResult.written} new msgs from ${ingestResult.files} files\n`)

  const dates = await discoverSessionDates()
  const allDates = dates.slice(0, limit)

  if (allDates.length === 0) {
    console.log(JSON.stringify({ success: true, message: 'No second-layer data found. Nothing to compress.' }))
    return
  }

  process.stderr.write(`\n📦 ${allDates.length} days to process${limit < Infinity ? ` (--limit ${limit})` : ''}\n`)
  process.stderr.write(`   Provider: ${llm.provider} | Model: ${llm.model_id}\n`)
  process.stderr.write(`   Mode: day-serial (session parallel per day, rolling per day)\n\n`)

  const startTime = Date.now()
  const failedSessions = new Set<string>()
  let skippedDays = 0
  let totalSessionMs = 0
  let totalRollingMs = 0
  let processedDays = 0
  let rollingDirty = false

  for (let dayIdx = 0; dayIdx < allDates.length; dayIdx++) {
    const date = allDates[dayIdx]
    const dayId = date

    const lastSnapshotExists = existsSync(join(SNAPSHOT_DIRS.recent, `${dayId}.md`))
    if (lastSnapshotExists && !rollingDirty) {
      process.stderr.write(`\n${progressBar(dayIdx + 1, allDates.length)} [${dayIdx + 1}/${allDates.length}] 📅 ${date}\n`)
      process.stderr.write(`   ⏭  skip (already done)\n`)
      skippedDays++
      continue
    }

    const sessionIds = await discoverSessionsForDate(date)
    if (sessionIds.length === 0) {
      process.stderr.write(`\n${progressBar(dayIdx + 1, allDates.length)} [${dayIdx + 1}/${allDates.length}] 📅 ${date}\n`)
      process.stderr.write(`   ⏭  skip (no sessions)\n`)
      skippedDays++
      continue
    }

    const elapsed = Date.now() - startTime
    const avgMs = processedDays > 0 ? elapsed / processedDays : 0
    const remaining = processedDays > 0 ? avgMs * (allDates.length - dayIdx) : 0
    const etaStr = processedDays > 0 ? ` ETA ${fmtDuration(remaining)}` : ''

    process.stderr.write(`\n${progressBar(dayIdx + 1, allDates.length)} [${dayIdx + 1}/${allDates.length}] 📅 ${date} (${sessionIds.length} sessions)${etaStr}\n`)

    const asOf = new Date(`${date}T23:59:59Z`)
    const ctx = await buildMemoryContext(budget, asOf)

    process.stderr.write(`   Phase 1: session parallel (${sessionIds.length})...\n`)
    const t0 = Date.now()

    await pMap(sessionIds, async (sessionId) => {
      const sessionShort = sessionId.slice(-6)
      try {
        await compressSecondToSession(sessionId, date, llm, budget, ctx)
      } catch (err) {
        log.error('compress', `session failed ${date}-${sessionShort}: ${err}`)
        failedSessions.add(`${date}-${sessionShort}`)
      }
    })

    const t1 = Date.now()
    totalSessionMs += t1 - t0
    process.stderr.write(`   📝 session ${fmtDuration(t1 - t0)} (${sessionIds.length} parallel)\n`)

    const { bodies: sessionBodies, ids: sessionIds2, flashbulbs: sessionFlashbulbs } = await getUnrolledSessionBodies()

    if (sessionBodies.length > 0) {
      process.stderr.write(`   Phase 2: rolling (${sessionBodies.length} sessions combined)...\n`)
      const t3 = Date.now()
      const combinedContent = sessionBodies.map((b, i) => `### ${sessionFlashbulbs[i] ? '⭐ ' : ''}${sessionIds2[i]}\n${b}`).join('\n\n---\n\n')
      await compressRolling(combinedContent, dayId, llm, budget, [dayId])
      const t4 = Date.now()
      totalRollingMs += t4 - t3
      process.stderr.write(`   🔄 rolling ${fmtDuration(t4 - t3)}\n`)
      rollingDirty = true
    }

    processedDays++
    process.stderr.write(`   ✅ day done\n`)
  }

  const totalMs = Date.now() - startTime
  process.stderr.write(`\n${progressBar(allDates.length, allDates.length)}\n`)

  process.stderr.write('   🔍 Rebuilding search index...\n')
  const { rebuildIndex } = await import('../memory/search-index.js')
  await rebuildIndex()

  const summary = {
    success: true,
    duration: fmtDuration(totalMs),
    total_days: allDates.length,
    processed: processedDays,
    skipped: skippedDays,
    failed: failedSessions.size,
    failed_sessions: [...failedSessions],
    session_time: fmtDuration(totalSessionMs),
    rolling_time: fmtDuration(totalRollingMs),
    avg_per_day: processedDays > 0 ? fmtDuration(totalMs / processedDays) : null,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (failedSessions.size > 0) {
    process.stderr.write(`\n⚠️  Run again to retry — completed tasks will be skipped.\n`)
  }
}
