import { loadConfig } from '../config.js'
import { updateMemoryFile } from '../memory/builder.js'
import { ensureDirectories, setDayBoundary } from '../storage/paths.js'

export async function runRefresh(): Promise<void> {
  const config = await loadConfig()
  setDayBoundary(config.timezone_offset, config.day_boundary_hour)
  await ensureDirectories()

  const results: { memory_file: string; success: boolean; error?: string }[] = []

  for (const target of config.watch) {
    try {
      await updateMemoryFile(target.memory_file, config.memory_budget, target.project)
      results.push({ memory_file: target.memory_file, success: true })
    } catch (err) {
      results.push({ memory_file: target.memory_file, success: false, error: String(err) })
    }
  }

  console.log(JSON.stringify({ refreshed: results }, null, 2))
}
