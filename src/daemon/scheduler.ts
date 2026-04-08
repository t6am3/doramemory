import cron from 'node-cron'
import { readdir } from 'fs/promises'
import { compressSecondToHour, compressHourToDay, compressDayToWeek, compressWeekToMonth, compressMonthToYear } from '../storage/compressor.js'
import { updateMemoryFile } from '../memory/builder.js'
import { LAYER_DIRS } from '../storage/paths.js'
import type { DoraConfig } from '../types.js'

// Return the previous hour: { date: "2026-04-07", hour: "13" }
function previousHour(): { date: string; hour: string } {
  const d = new Date(Date.now() - 3600000)
  return {
    date: d.toISOString().slice(0, 10),
    hour: String(d.getUTCHours()).padStart(2, '0'),
  }
}

function previousDay(): string {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10)
}

// ISO week string for previous week: "2026-W13"
function previousWeek(): string {
  const d = new Date(Date.now() - 7 * 86400000)
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function previousMonth(): string {
  const d = new Date()
  const m = d.getMonth() === 0 ? 12 : d.getMonth()
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear()
  return `${y}-${String(m).padStart(2, '0')}`
}

function previousYear(): string {
  return String(new Date().getFullYear() - 1)
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

async function refreshMemory(config: DoraConfig): Promise<void> {
  for (const target of config.watch) {
    await updateMemoryFile(target.memory_file).catch(console.error)
  }
}

// 整小时触发：压缩上一小时的 second/ → hour/
async function runHourlyCompression(config: DoraConfig): Promise<void> {
  const { date, hour } = previousHour()
  const llm = config.compression.model
  console.log(`[scheduler] Hour compression: ${date}-${hour}`)
  try {
    await compressSecondToHour(date, hour, llm)
    await refreshMemory(config)
  } catch (err) {
    console.error('[scheduler] Hour compression failed:', err)
  }
}

// 整天触发（00:00）：压缩昨天的 hour/ → day/
async function runDailyCompression(config: DoraConfig): Promise<void> {
  const date = previousDay()
  const llm = config.compression.model
  console.log(`[scheduler] Day compression: ${date}`)
  try {
    const { flashbulb } = await compressHourToDay(date, llm)
    if (flashbulb) await saveFlashbulb(date, flashbulb)
    await refreshMemory(config)
  } catch (err) {
    console.error('[scheduler] Day compression failed:', err)
  }
}

// 每周一 00:00：压缩上周的 day/ → week/
async function runWeeklyCompression(config: DoraConfig): Promise<void> {
  const week = previousWeek()
  const llm = config.compression.model
  console.log(`[scheduler] Week compression: ${week}`)
  try {
    await compressDayToWeek(week, llm)
    await refreshMemory(config)
  } catch (err) {
    console.error('[scheduler] Week compression failed:', err)
  }
}

// 每月1日 00:00：压缩上月的 week/ → month/
async function runMonthlyCompression(config: DoraConfig): Promise<void> {
  const month = previousMonth()
  const llm = config.compression.model
  console.log(`[scheduler] Month compression: ${month}`)
  try {
    await compressWeekToMonth(month, llm)
    await refreshMemory(config)
  } catch (err) {
    console.error('[scheduler] Month compression failed:', err)
  }
}

// 每年1月1日 00:00：压缩上年的 month/ → year/
async function runYearlyCompression(config: DoraConfig): Promise<void> {
  const year = previousYear()
  const llm = config.compression.model
  console.log(`[scheduler] Year compression: ${year}`)
  try {
    await compressMonthToYear(year, llm)
    await refreshMemory(config)
  } catch (err) {
    console.error('[scheduler] Year compression failed:', err)
  }
}

export function startScheduler(config: DoraConfig): void {
  cron.schedule('0 * * * *',   () => runHourlyCompression(config))   // 整小时
  cron.schedule('0 0 * * *',   () => runDailyCompression(config))    // 每天 00:00
  cron.schedule('0 0 * * 1',   () => runWeeklyCompression(config))   // 每周一 00:00
  cron.schedule('0 0 1 * *',   () => runMonthlyCompression(config))  // 每月1日
  cron.schedule('0 0 1 1 *',   () => runYearlyCompression(config))   // 每年1月1日

  console.log('[scheduler] Started')
  console.log('  second→hour : 整小时')
  console.log('  hour→day    : 每天 00:00')
  console.log('  day→week    : 每周一 00:00')
  console.log('  week→month  : 每月1日 00:00')
  console.log('  month→year  : 每年1月1日 00:00')
}
