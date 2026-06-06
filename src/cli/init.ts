import * as p from '@clack/prompts'
import { existsSync, readdirSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve, dirname } from 'path'
import yaml from 'js-yaml'
import { saveConfig, DEFAULT_CONFIG } from '../config.js'
import { ensureDirectories, CONFIG_FILE, LAYER_DIRS } from '../storage/paths.js'
import { runCompress } from './compress.js'
import { claudeMcpConfigPath, expandUserPath, npmBinary } from '../platform.js'
import type { DoraConfig, LLMProvider } from '../types.js'

const KNOWN_AGENTS = [
  {
    name:        'Claude Code',
    path:        join(homedir(), '.claude', 'projects'),
    format:      'claude' as const,
    memory_file: join(homedir(), '.claude', 'CLAUDE.md'),
  },
  {
    name:        'OpenClaw',
    path:        join(homedir(), '.openclaw', 'agents'),
    format:      'openclaw' as const,
    memory_file: join(homedir(), '.openclaw', 'workspace', 'MEMORY.md'),
  },
  {
    name:        'Cursor',
    path:        join(homedir(), '.cursor', 'conversations'),
    format:      'openai' as const,
    memory_file: join(homedir(), '.cursor', '.cursorrules'),
  },
]

async function detectAgents() {
  return KNOWN_AGENTS.filter(a => existsSync(a.path))
}

async function checkPlaceholder(memoryFile: string): Promise<boolean> {
  if (!existsSync(memoryFile)) return false
  const content = await readFile(memoryFile, 'utf8')
  return content.includes('{{DORAMEMORY}}')
}

async function injectMcpConfig(): Promise<void> {
  const mcpConfigPath = claudeMcpConfigPath()
  let config: Record<string, unknown> = {}

  if (existsSync(mcpConfigPath)) {
    const raw = await readFile(mcpConfigPath, 'utf8')
    config = JSON.parse(raw)
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>
  servers['doramemory'] = {
    command: npmBinary('npx'),
    args:    ['doramemory', 'mcp'],
  }
  config.mcpServers = servers

  await mkdir(dirname(mcpConfigPath), { recursive: true })
  await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf8')
}

export async function runInit(args: string[] = []): Promise<void> {
  const configIdx = args.indexOf('--config')
  if (configIdx !== -1 && args[configIdx + 1]) {
    await runNonInteractiveInit(args[configIdx + 1])
    return
  }

  if (!process.stdin.isTTY) {
    if (existsSync(CONFIG_FILE)) {
      console.log(JSON.stringify({ success: true, message: 'config already exists', path: CONFIG_FILE }))
      return
    }
    console.error('Non-interactive mode requires --config <path>. Example:')
    console.error('  npx doramemory init --config ./config.yaml')
    process.exit(1)
  }

  await runInteractiveInit()
}

async function runNonInteractiveInit(configPath: string): Promise<void> {
  const absPath = resolve(configPath)
  if (!existsSync(absPath)) {
    console.error(JSON.stringify({ error: `Config file not found: ${absPath}` }))
    process.exit(1)
  }

  const raw = await readFile(absPath, 'utf8')
  const loaded = yaml.load(raw) as Partial<DoraConfig>

  const config: DoraConfig = {
    ...DEFAULT_CONFIG,
    ...loaded,
    memory_budget: { ...DEFAULT_CONFIG.memory_budget, ...loaded.memory_budget },
  }

  config.watch = config.watch.map(w => ({
    ...w,
    path:        expandUserPath(w.path),
    memory_file: expandUserPath(w.memory_file),
  }))

  if (!config.compression?.model?.provider || !config.compression?.model?.model_id) {
    console.error(JSON.stringify({ error: 'config must include compression.model.provider and compression.model.model_id' }))
    process.exit(1)
  }

  await ensureDirectories()
  await saveConfig(config)
  await injectMcpConfig().catch(() => {
    process.stderr.write('[warn] Failed to inject MCP config (permission denied), skipping.\n')
  })

  console.log(JSON.stringify({
    success: true,
    config_file: CONFIG_FILE,
    watch: config.watch.map(w => ({ path: w.path, format: w.format, memory_file: w.memory_file })),
    model: { provider: config.compression.model.provider, model_id: config.compression.model.model_id },
  }))
}

async function runInteractiveInit(): Promise<void> {
  p.intro('DoraMemory — 初始化')

  // Step 1: Detect agents
  const detected = await detectAgents()
  if (detected.length === 0) {
    p.outro('未检测到支持的 agent 产品。请手动配置 ~/.doramemory/config.yaml')
    return
  }

  const selectedAgents = await p.multiselect({
    message: '检测到以下 agent 产品，选择要监控的：',
    options: detected.map(a => ({ value: a.name, label: `${a.name}  (${a.path})` })),
  })
  if (p.isCancel(selectedAgents)) { p.cancel('已取消'); return }

  const watchTargets = detected.filter(a => (selectedAgents as string[]).includes(a.name))

  // Step 2: Check placeholders
  for (const target of watchTargets) {
    const hasPlaceholder = await checkPlaceholder(target.memory_file)
    if (!hasPlaceholder) {
      if (!existsSync(target.memory_file)) {
        await mkdir(dirname(target.memory_file), { recursive: true })
        await writeFile(target.memory_file, '\n{{DORAMEMORY}}\n', 'utf8')
        p.log.success(`已创建 ${target.memory_file} 并注入占位符`)
      } else {
        const content = await readFile(target.memory_file, 'utf8')
        await writeFile(target.memory_file, content.trimEnd() + '\n\n{{DORAMEMORY}}\n', 'utf8')
        p.log.success(`已在 ${target.memory_file} 末尾注入占位符`)
      }
    } else {
      p.log.info(`${target.memory_file} 已有占位符，跳过`)
    }
  }

  // Step 3: Configure LLM
  const llmChoice = await p.select({
    message: '选择压缩模型配置方式：',
    options: [
      { value: 'anthropic-default',      label: 'Anthropic 预设      (claude-haiku-4-5)' },
      { value: 'oai-completion-default', label: 'OAI-Completion 预设 (gpt-4o-mini, Chat Completions API)' },
      { value: 'oai-response-default',  label: 'OAI-Response 预设   (gpt-4o-mini, Responses API)' },
      { value: 'custom',                 label: '自定义               (选协议 + 填 model / url / key)' },
    ],
  }) as string
  if (p.isCancel(llmChoice)) { p.cancel('已取消'); return }

  let llmProvider: LLMProvider
  let modelId: string
  let baseUrl: string | undefined
  let apiKey: string | undefined

  if (llmChoice === 'custom') {
    const protocol = await p.select({
      message: '选择 LLM 通信协议：',
      options: [
        { value: 'oai-completion', label: 'OAI-Completion  (OpenAI Chat Completions API，兼容大多数第三方)' },
        { value: 'oai-response',  label: 'OAI-Response    (OpenAI Responses API)' },
        { value: 'anthropic',      label: 'Anthropic       (Anthropic Messages API)' },
      ],
    }) as LLMProvider
    if (p.isCancel(protocol)) { p.cancel('已取消'); return }
    llmProvider = protocol

    const mid = await p.text({ message: 'Model ID:' })
    if (p.isCancel(mid)) { p.cancel('已取消'); return }
    modelId = mid as string

    const url = await p.text({
      message: 'Base URL (留空使用默认):',
      placeholder: llmProvider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    })
    if (p.isCancel(url)) { p.cancel('已取消'); return }
    if (url) baseUrl = url as string

    const key = await p.text({ message: 'API Key (留空则填 none):' })
    if (p.isCancel(key)) { p.cancel('已取消'); return }
    apiKey = (key as string) || 'none'
  } else if (llmChoice === 'anthropic-default') {
    llmProvider = 'anthropic'
    modelId = 'claude-haiku-4-5-20251001'
    apiKey  = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      const key = await p.text({ message: 'Anthropic API Key:' })
      if (p.isCancel(key)) { p.cancel('已取消'); return }
      apiKey = key as string
    } else {
      p.log.success('检测到 ANTHROPIC_API_KEY，直接使用')
    }
  } else {
    llmProvider = llmChoice.replace('-default', '') as LLMProvider
    modelId = 'gpt-4o-mini'
    apiKey  = process.env.OPENAI_API_KEY
    if (!apiKey) {
      const key = await p.text({ message: 'OpenAI API Key:' })
      if (p.isCancel(key)) { p.cancel('已取消'); return }
      apiKey = key as string
    } else {
      p.log.success('检测到 OPENAI_API_KEY，直接使用')
    }
  }

  // Step 4: Save config + install
  const config: DoraConfig = {
    watch: watchTargets.map(t => ({
      path:        t.path,
      format:      t.format,
      memory_file: t.memory_file,
    })),
    compression: {
      model: { provider: llmProvider, model_id: modelId, api_key: apiKey, base_url: baseUrl },
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
    cold_start_days:                7,
    session_gap_minutes:            30,
    memory_update_throttle_seconds: 300,
    timezone_offset:                8,
    day_boundary_hour:              4,
  }

  const spinner = p.spinner()
  spinner.start('正在安装...')

  await saveConfig(config)
  await injectMcpConfig()

  spinner.stop('安装完成')

  // Step 5: Check for existing data and offer compression
  const secondDir = LAYER_DIRS.second
  if (existsSync(secondDir)) {
    const files = readdirSync(secondDir).filter(f => f.endsWith('.jsonl'))
    if (files.length > 0) {
      const doCompress = await p.select({
        message: `检测到 ${files.length} 小时的存量记忆数据，是否现在压缩？`,
        options: [
          { value: 'yes',   label: '立即压缩存量数据' },
          { value: 'fresh', label: '清空已有压缩结果后重新压缩 (--fresh)' },
          { value: 'no',    label: '跳过，稍后手动运行 npx doramemory compress' },
        ],
      }) as string
      if (!p.isCancel(doCompress) && doCompress !== 'no') {
        const args = doCompress === 'fresh' ? ['--fresh'] : []
        await runCompress(args)
      }
    }
  }

  p.note(
    '启动守护进程：  npx doramemory start\n' +
    '查看状态：      npx doramemory status\n' +
    '停止：          npx doramemory stop',
    '下一步'
  )

  p.outro('DoraMemory 已配置完毕。')
}
