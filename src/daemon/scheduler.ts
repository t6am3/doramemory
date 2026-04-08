import cron from 'node-cron'
import { readdir } from 'fs/promises'
import { compressSecondToHour, compressHourToDay } from '../storage/compressor.js'
import { updateMemoryFile } from '../memory/builder.js'
import { LAYER_DIRS } from '../storage/paths.js'
import type { DoraConfig } from '../types.js'

function yesterdayDate(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

async function runDailyCompression(config: DoraConfig): Promise<void> {
  const date = yesterdayDate()
  const llm = config.compression.model

  console.log(`[scheduler] Compressing ${date}...`)

  try {
    // Step 1: second/ → hour/  (for each hour that has data)
    const secondFiles = await readdir(LAYER_DIRS.second).catch(() => [] as string[])
    const hours = [
      ...new Set(
        secondFiles
          .filter(f => f.startsWith(date))
          .map(f => f.slice(11, 13))  // extract hour digits
      ),
    ]
    for (const hour of hours) {
      await compressSecondToHour(date, hour, llm)
    }

    // Step 2: hour/ → day/
    const { flashbulb } = await compressHourToDay(date, llm)
    if (flashbulb) {
      await saveFlashbulb(date, flashbulb)
    }

    // Step 3: Refresh MEMORY.md for all watch targets
    for (const target of config.watch) {
      await updateMemoryFile(target.memory_file)
    }

    console.log(`[scheduler] ${date} compression done.`)
  } catch (err) {
    console.error(`[scheduler] Compression failed for ${date}:`, err)
  }
}

async function saveFlashbulb(date: string, description: string): Promise<void> {
  const { mkdir, writeFile } = await import('fs/promises')
  const { join } = await import('path')
  const yaml = await import('js-yaml')
  const { LAYER_DIRS: dirs } = await import('../storage/paths.js')

  const dir = join(dirs.core, 'recent')
  await mkdir(dir, { recursive: true })

  const id = `${date}-flashbulb`
  const filePath = join(dir, `${id}.md`)
  const frontmatter = { id, flashbulb: true, compressed: false, sources: [date] }
  await writeFile(
    filePath,
    `---\n${yaml.default.dump(frontmatter)}---\n\n${description}\n`,
    'utf8'
  )
  console.log(`[scheduler] Flashbulb saved: ${description}`)
}

export function startScheduler(config: DoraConfig): void {
  // Run daily compression at 01:00 AM
  cron.schedule('0 1 * * *', () => runDailyCompression(config))

  // Refresh MEMORY.md every 5 minutes (throttled in builder)
  cron.schedule('*/5 * * * *', async () => {
    for (const target of config.watch) {
      await updateMemoryFile(target.memory_file).catch(console.error)
    }
  })

  console.log('[scheduler] Started (daily compression at 01:00, memory refresh every 5m)')
}
