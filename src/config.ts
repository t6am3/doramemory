import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import yaml from 'js-yaml'
import { CONFIG_FILE, ensureDirectories } from './storage/paths.js'
import type { DoraConfig } from './types.js'

const DEFAULT_CONFIG: DoraConfig = {
  watch: [
    {
      path:        join(homedir(), '.claude', 'projects'),
      format:      'claude',
      memory_file: join(homedir(), '.claude', 'CLAUDE.md'),
    },
  ],
  compression: {
    model: {
      provider: 'anthropic',
      model_id: 'claude-haiku-4-5-20251001',
      api_key:  process.env.ANTHROPIC_API_KEY,
    },
  },
  cold_start_days:                 7,
  session_gap_minutes:             30,
  memory_update_throttle_seconds:  300,
}

export async function loadConfig(): Promise<DoraConfig> {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG
  const raw = await readFile(CONFIG_FILE, 'utf8')
  const loaded = yaml.load(raw) as Partial<DoraConfig>
  // Merge with defaults so new fields don't break old configs
  return { ...DEFAULT_CONFIG, ...loaded }
}

export async function saveConfig(config: DoraConfig): Promise<void> {
  await ensureDirectories()
  await writeFile(CONFIG_FILE, yaml.dump(config), 'utf8')
}

export { DEFAULT_CONFIG }
