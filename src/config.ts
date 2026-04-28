import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import yaml from 'js-yaml'
import { CONFIG_FILE, ensureDirectories } from './storage/paths.js'
import type { DoraConfig, LLMProvider } from './types.js'

const PROVIDER_COMPAT: Record<string, LLMProvider> = {
  openai: 'oai-completion',
  custom: 'oai-completion',
}

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
  memory_budget: {
    identity:  { max_tokens: 200 },
    flashbulb: { max_tokens: 2000, max_entries: 5,  max_tokens_per_entry: 60  },
    session:   { max_tokens: 4000, max_entries: 10, max_tokens_per_entry: 1000 },
    rolling:   {
      recent:   { max_tokens: 2000 },
      distant:  { max_tokens: 1000 },
      lifetime: { max_tokens: 500  },
      identity: { max_tokens: 500  },
    },
  },
  cold_start_days:                 7,
  session_gap_minutes:             30,
  memory_update_throttle_seconds:  300,
  session_compress_threshold:      16000,
  rolling_trigger_threshold:       4000,
  timezone_offset:                 8,
  day_boundary_hour:               4,
}

function migrateConfig(config: Partial<DoraConfig>): Partial<DoraConfig> {
  if (config.compression?.model?.provider) {
    const p = config.compression.model.provider as string
    if (p in PROVIDER_COMPAT) {
      config.compression.model.provider = PROVIDER_COMPAT[p]
    }
  }
  return config
}

export async function loadConfig(): Promise<DoraConfig> {
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG
  const raw = await readFile(CONFIG_FILE, 'utf8')
  const loaded = migrateConfig(yaml.load(raw) as Partial<DoraConfig>)
  const db = DEFAULT_CONFIG.memory_budget
  const lb = (loaded.memory_budget ?? {}) as Partial<typeof db>
  return {
    ...DEFAULT_CONFIG,
    ...loaded,
    memory_budget: {
      ...db,
      ...lb,
      flashbulb: { ...db.flashbulb, ...(lb.flashbulb as Partial<typeof db.flashbulb>) },
      session:   { ...db.session,   ...(lb.session   as Partial<typeof db.session>) },
    },
  }
}

export async function saveConfig(config: DoraConfig): Promise<void> {
  await ensureDirectories()
  await writeFile(CONFIG_FILE, yaml.dump(config), 'utf8')
}

export { DEFAULT_CONFIG }
