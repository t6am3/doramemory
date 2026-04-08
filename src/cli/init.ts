import * as p from '@clack/prompts'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { saveConfig } from '../config.js'
import type { DoraConfig, LLMProvider } from '../types.js'

const KNOWN_AGENTS = [
  {
    name:        'Claude Code',
    path:        join(homedir(), '.claude', 'projects'),
    format:      'claude' as const,
    memory_file: join(homedir(), '.claude', 'CLAUDE.md'),
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
  const mcpConfigPath = join(homedir(), '.claude', 'claude_desktop_config.json')
  let config: Record<string, unknown> = {}

  if (existsSync(mcpConfigPath)) {
    const raw = await readFile(mcpConfigPath, 'utf8')
    config = JSON.parse(raw)
  }

  const servers = (config.mcpServers ?? {}) as Record<string, unknown>
  servers['doramemory'] = {
    command: 'npx',
    args:    ['doramemory', 'mcp'],
  }
  config.mcpServers = servers

  await mkdir(join(homedir(), '.claude'), { recursive: true })
  await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf8')
}

export async function runInit(): Promise<void> {
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
    initialValues: detected.map(a => a.name),
  })
  if (p.isCancel(selectedAgents)) { p.cancel('已取消'); return }

  const watchTargets = detected.filter(a => (selectedAgents as string[]).includes(a.name))

  // Step 2: Check placeholders
  for (const target of watchTargets) {
    const hasPlaceholder = await checkPlaceholder(target.memory_file)
    if (!hasPlaceholder) {
      p.note(
        `请在 ${target.memory_file} 中添加：\n\n  ## Memory\n  {{DORAMEMORY}}\n\n然后按回车继续。`,
        `设置 ${target.name} 记忆占位符`
      )
      await p.text({ message: '完成后按回车...' })
    }
  }

  // Step 3: Configure LLM
  const llmProvider = await p.select({
    message: '选择压缩模型接口：',
    options: [
      { value: 'anthropic', label: 'Anthropic  (claude-haiku-4-5)' },
      { value: 'openai',    label: 'OpenAI     (gpt-4o-mini)' },
      { value: 'custom',    label: '自定义      (填写 model / url / key)' },
    ],
  }) as LLMProvider
  if (p.isCancel(llmProvider)) { p.cancel('已取消'); return }

  let modelId = 'claude-haiku-4-5-20251001'
  let baseUrl: string | undefined
  let apiKey: string | undefined

  if (llmProvider === 'anthropic') {
    modelId = 'claude-haiku-4-5-20251001'
    apiKey  = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      const key = await p.text({ message: 'Anthropic API Key:' })
      if (p.isCancel(key)) { p.cancel('已取消'); return }
      apiKey = key as string
    } else {
      p.log.success('检测到 ANTHROPIC_API_KEY，直接使用')
    }
  } else if (llmProvider === 'openai') {
    modelId = 'gpt-4o-mini'
    apiKey  = process.env.OPENAI_API_KEY
    if (!apiKey) {
      const key = await p.text({ message: 'OpenAI API Key:' })
      if (p.isCancel(key)) { p.cancel('已取消'); return }
      apiKey = key as string
    } else {
      p.log.success('检测到 OPENAI_API_KEY，直接使用')
    }
  } else {
    const mid = await p.text({ message: 'Model ID:' })
    if (p.isCancel(mid)) { p.cancel('已取消'); return }
    modelId = mid as string

    const url = await p.text({ message: 'Base URL (e.g. http://localhost:11434/v1):' })
    if (p.isCancel(url)) { p.cancel('已取消'); return }
    baseUrl = url as string

    const key = await p.text({ message: 'API Key (留空则填 none):' })
    if (p.isCancel(key)) { p.cancel('已取消'); return }
    apiKey = (key as string) || 'none'
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
    cold_start_days:                7,
    session_gap_minutes:            30,
    memory_update_throttle_seconds: 300,
  }

  const spinner = p.spinner()
  spinner.start('正在安装...')

  await saveConfig(config)
  await injectMcpConfig()

  spinner.stop('安装完成')

  p.note(
    '启动守护进程：  npx doramemory start\n' +
    '查看状态：      npx doramemory status\n' +
    '停止：          npx doramemory stop',
    '下一步'
  )

  p.outro('DoraMemory 已配置完毕。')
}
