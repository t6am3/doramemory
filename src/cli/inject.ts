import { existsSync, readFileSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { loadConfig, saveConfig } from '../config.js'
import { updateMemoryFile } from '../memory/builder.js'
import { ensureDirectories, PID_FILE, setDayBoundary } from '../storage/paths.js'
import { inferProject } from '../daemon/watcher.js'
import type { WatchFormat } from '../types.js'

function guessFormat(filePath: string): WatchFormat {
  const lower = filePath.toLowerCase()
  if (lower.includes('.claude') || lower.includes('claude.md')) return 'claude'
  if (lower.includes('.openclaw') || lower.includes('memory.md')) return 'openclaw'
  if (lower.includes('.cursor') || lower.includes('cursorrules')) return 'openai'
  return 'claude'
}

function guessWatchPath(filePath: string, format: WatchFormat): string {
  const dir = dirname(filePath)
  if (format === 'claude') {
    const projectsDir = resolve(dir, '..', '.claude', 'projects')
    if (existsSync(projectsDir)) return projectsDir
    return resolve(dir, '.claude', 'projects')
  }
  return dir
}

function notifyDaemon(): boolean {
  if (!existsSync(PID_FILE)) return false
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
  if (!pid) return false
  try {
    process.kill(pid, 'SIGHUP')
    return true
  } catch {
    return false
  }
}

export async function runInject(args: string[]): Promise<void> {
  const filePath = args[0]
  if (!filePath) {
    console.error(JSON.stringify({ error: 'Usage: npx doramemory inject <file_path> [--format claude|openclaw|openai]' }))
    process.exitCode = 1
    return
  }

  const absPath = resolve(filePath)
  let format: WatchFormat | undefined
  const fmtIdx = args.indexOf('--format')
  if (fmtIdx !== -1 && args[fmtIdx + 1]) {
    format = args[fmtIdx + 1] as WatchFormat
  }

  await ensureDirectories()
  const config = await loadConfig()
  setDayBoundary(config.timezone_offset, config.day_boundary_hour)

  if (!existsSync(absPath)) {
    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, '\n{{DORAMEMORY}}\n', 'utf8')
  } else {
    const content = await readFile(absPath, 'utf8')
    if (!content.includes('{{DORAMEMORY}}')) {
      await writeFile(absPath, content.trimEnd() + '\n\n{{DORAMEMORY}}\n', 'utf8')
    }
  }

  const resolvedFormat = format ?? guessFormat(absPath)
  const watchPath = guessWatchPath(absPath, resolvedFormat)
  const resolvedProject = inferProject(watchPath, resolvedFormat)
  const alreadyWatched = config.watch.some(w => w.memory_file === absPath)

  if (!alreadyWatched) {
    config.watch.push({
      path: watchPath,
      format: resolvedFormat,
      memory_file: absPath,
      project: resolvedProject,
    })
    await saveConfig(config)
  }

  await updateMemoryFile(absPath, config.memory_budget, resolvedProject)

  const daemonNotified = notifyDaemon()

  console.log(JSON.stringify({
    success: true,
    file: absPath,
    format: resolvedFormat,
    project: resolvedProject,
    added_to_watch: !alreadyWatched,
    daemon_notified: daemonNotified,
  }, null, 2))
}
