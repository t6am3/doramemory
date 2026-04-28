import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { log } from '../logger.js'
import { TRACES_DIR } from '../storage/paths.js'
import { recordUsage } from './usage.js'
import type { LLMConfig, CompressAsInput, CompressAsOutput, RollingBudgetConfig, RollingFile } from '../types.js'

export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

async function saveTrace(type: string, id: string, data: unknown): Promise<void> {
  try {
    const filename = `${type}-${id}.json`
    const filepath = join(TRACES_DIR, filename)
    await writeFile(filepath, JSON.stringify(data, null, 2), 'utf8')
    log.debug('llm', `trace saved: ${filename}`)
  } catch (err) {
    log.warn('llm', `failed to save trace: ${err}`)
  }
}

const TRANSIENT_STATUS = new Set([429, 529, 500, 502, 503, 504])
const MAX_HTTP_RETRIES = 3
const BASE_DELAY_MS = 2000

function isTransientError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const status = (err as { status?: number }).status
    if (status && TRANSIENT_STATUS.has(status)) return true
    const code = (err as { code?: string }).code
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') return true
    const msg = String((err as { message?: string }).message ?? '')
    if (/overloaded|rate.?limit|too many requests|timeout|network/i.test(msg)) return true
  }
  return false
}

async function retryOnTransient<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= MAX_HTTP_RETRIES || !isTransientError(err)) throw err
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      log.warn('llm', `[${label}] transient error (attempt ${attempt}/${MAX_HTTP_RETRIES}), retrying in ${delay}ms: ${err}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// Agentic compression: LLM must call compress_as tool to submit result.
// Validates token limit and retries up to maxRetries times.
export async function callLLMWithCompressAs(
  config: LLMConfig,
  prompt: string,
  layer: CompressAsInput['layer'],
  id: string,
  tokenLimit: number,
  maxRetries = 3,
): Promise<CompressAsOutput & { title: string; content: string; flashbulb: boolean }> {
  log.info('llm', `compress_as start: provider=${config.provider} model=${config.model_id} layer=${layer} id=${id} limit=${tokenLimit}`)

  if (config.provider === 'anthropic') {
    return callAnthropicWithCompressAs(config, prompt, layer, id, tokenLimit, maxRetries)
  }
  if (config.provider === 'oai-response') {
    return callOAIResponseWithCompressAs(config, prompt, layer, id, tokenLimit, maxRetries)
  }
  return callOAICompletionWithCompressAs(config, prompt, layer, id, tokenLimit, maxRetries)
}

async function callAnthropicWithCompressAs(
  config: LLMConfig,
  prompt: string,
  layer: CompressAsInput['layer'],
  id: string,
  tokenLimit: number,
  maxRetries: number,
): Promise<CompressAsOutput & { title: string; content: string; flashbulb: boolean }> {
  const client = new Anthropic({ apiKey: config.api_key, ...(config.base_url && { baseURL: config.base_url }) })

  const tool: Anthropic.Tool = {
    name: 'compress_as',
    description: `Submit your compressed memory. Write as detailed and thorough as possible — capture all important context, causality, and outcomes. You MUST call this tool to submit your result.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        title:     { type: 'string', description: 'A concise title for this session (under 50 chars)' },
        content:   { type: 'string', description: 'The compressed memory text' },
        flashbulb: { type: 'boolean', description: 'Mark as important memory that should resist further compression' },
      },
      required: ['title', 'content'],
    },
  }

  log.debug('llm', `[anthropic] prompt (${estimateTokens(prompt)} tokens):\n${prompt.slice(0, 500)}${prompt.length > 500 ? '...[truncated]' : ''}`)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  let noToolRetried = false

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const msg = await retryOnTransient('anthropic', () => client.messages.create({
      model:      config.model_id,
      max_tokens: 16384,
      tools:      [tool],
      tool_choice: { type: 'tool', name: 'compress_as' },
      messages,
    }))
    recordUsage({ input_tokens: msg.usage?.input_tokens ?? 0, output_tokens: msg.usage?.output_tokens ?? 0, model: config.model_id, task: 'session_compress' }).catch(() => {})

    const toolBlock = msg.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      const thinkingBlock = msg.content.find(b => b.type === 'thinking')
      if (thinkingBlock && !noToolRetried) {
        log.warn('llm', `[anthropic] thinking-only response for ${layer}/${id} (no tool_use), retrying with thinking context...`)
        noToolRetried = true
        messages.push(
          { role: 'assistant', content: msg.content },
          { role: 'user', content: '你刚才只输出了思考过程，没有调用工具。请直接调用 compress_as 工具提交压缩结果。不要再思考，直接调用工具。' },
        )
        continue
      }
      if (!noToolRetried) {
        log.warn('llm', `[anthropic] compress_as not called for ${layer}/${id}, response: ${JSON.stringify(msg.content).slice(0, 500)}, retrying...`)
        noToolRetried = true
        messages.push(
          { role: 'assistant', content: msg.content },
          { role: 'user', content: '你必须调用 compress_as 工具来提交压缩结果，不能直接输出文本。请调用 compress_as 工具。' },
        )
        continue
      }
      await saveTrace(`compress-${layer}-fail`, id, {
        provider: 'anthropic', model: config.model_id, layer, id, tokenLimit,
        error: 'no_tool_call', messages,
        lastResponse: msg.content,
      })
      throw new Error('LLM did not call compress_as tool')
    }

    const input = toolBlock.input as { title?: string; content?: string; flashbulb?: boolean } | undefined
    if (!input?.content) {
      log.warn('llm', `[anthropic] compress_as returned empty/missing content for ${layer}/${id}, input: ${JSON.stringify(input).slice(0, 500)}, retrying...`)
      messages.push(
        { role: 'assistant', content: msg.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: '错误：content 字段为空。请重新调用 compress_as 工具，content 字段不能为空。',
            is_error: true,
          }],
        }
      )
      continue
    }
    const tokensUsed = estimateTokens(input.content)
    log.debug('llm', `[anthropic] compress_as called: tokens=${tokensUsed}/${tokenLimit} flashbulb=${input.flashbulb ?? false}\n${input.content}`)

    if (tokensUsed <= tokenLimit) {
      await saveTrace(`compress-${layer}`, id, {
        provider: 'anthropic', model: config.model_id, layer, id, tokenLimit,
        messages,
        result: { content: input.content, flashbulb: input.flashbulb ?? false, tokens_used: tokensUsed },
      })
      return {
        success:      true,
        tokens_used:  tokensUsed,
        tokens_limit: tokenLimit,
        title:        input.title ?? '',
        content:      input.content,
        flashbulb:    input.flashbulb ?? false,
      }
    }

    if (attempt === maxRetries) {
      const maxChars = tokenLimit * CHARS_PER_TOKEN
      const truncated = input.content.slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      const finalContent = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `Force truncated ${layer}/${id}: ${tokensUsed} → ${estimateTokens(finalContent)} tokens (anthropic)`)
      await saveTrace(`compress-${layer}`, id, {
        provider: 'anthropic', model: config.model_id, layer, id, tokenLimit,
        messages, forceTruncated: true,
        result: { content: finalContent, flashbulb: input.flashbulb ?? false, tokens_used: estimateTokens(finalContent) },
      })
      return {
        success:      true,
        tokens_used:  estimateTokens(finalContent),
        tokens_limit: tokenLimit,
        title:        input.title ?? '',
        content:      finalContent,
        flashbulb:    input.flashbulb ?? false,
      }
    }

    // Ask LLM to retry with error feedback
    log.debug('llm', `Retry ${attempt + 1}/${maxRetries} for ${layer}/${id}: ${tokensUsed}/${tokenLimit} tokens (anthropic)`)
    messages.push(
      { role: 'assistant', content: msg.content },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: `错误：超出限制。当前 ${tokensUsed} tokens，上限 ${tokenLimit} tokens。请进一步压缩，去掉次要细节，只保留最核心的信息。`,
          is_error: true,
        }],
      }
    )
  }

  await saveTrace(`compress-${layer}-fail`, id, {
    provider: 'anthropic', model: config.model_id, layer, id, tokenLimit,
    error: 'max_retries_exhausted', messages,
  })
  throw new Error('Unreachable')
}

// ──────────────────────────────────────────
// Rolling memory: multi-turn tool-use agent
// ──────────────────────────────────────────

export interface RollingResult {
  identity: string
  recent:   string
  distant:  string
  lifetime: string
}

const ROLLING_FILE_NAMES: RollingFile[] = ['identity', 'recent', 'distant', 'lifetime']

export async function callLLMWithRollingTools(
  config: LLMConfig,
  prompt: string,
  initialFiles: Record<RollingFile, string>,
  budgets: RollingBudgetConfig,
  maxTurns = 10,
  traceId = 'unknown',
  lockedFiles: RollingFile[] = [],
): Promise<RollingResult> {
  log.info('llm', `rolling start: provider=${config.provider} model=${config.model_id}`)

  if (config.provider === 'anthropic') {
    return callAnthropicRolling(config, prompt, initialFiles, budgets, maxTurns, traceId, lockedFiles)
  }
  if (config.provider === 'oai-response') {
    return callOAIResponseRolling(config, prompt, initialFiles, budgets, maxTurns, traceId, lockedFiles)
  }
  return callOAICompletionRolling(config, prompt, initialFiles, budgets, maxTurns, traceId, lockedFiles)
}

function buildRollingToolsAnthropic(): Anthropic.Tool[] {
  return [
    {
      name: 'read_memory',
      description: '读取一个记忆文件的当前内容',
      input_schema: {
        type: 'object' as const,
        properties: {
          file: { type: 'string', enum: ROLLING_FILE_NAMES, description: '要读取的文件：recent / distant / lifetime' },
        },
        required: ['file'],
      },
    },
    {
      name: 'write_memory',
      description: '覆写一个记忆文件的全部内容',
      input_schema: {
        type: 'object' as const,
        properties: {
          file:    { type: 'string', enum: ROLLING_FILE_NAMES, description: '要写入的文件' },
          content: { type: 'string', description: '新的完整内容' },
          action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
          reason:  { type: 'string', description: '简述修改原因' },
        },
        required: ['file', 'content', 'action', 'reason'],
      },
    },
    {
      name: 'edit_memory',
      description: '局部编辑一个记忆文件：找到 old_str 并替换为 new_str',
      input_schema: {
        type: 'object' as const,
        properties: {
          file:    { type: 'string', enum: ROLLING_FILE_NAMES, description: '要编辑的文件' },
          old_str: { type: 'string', description: '要被替换的原文' },
          new_str: { type: 'string', description: '替换后的新文' },
          action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
          reason:  { type: 'string', description: '简述修改原因' },
        },
        required: ['file', 'old_str', 'new_str', 'action', 'reason'],
      },
    },
    {
      name: 'commit_memory',
      description: '提交所有修改。会校验每个文件是否在 token 上限内。通过的文件会被保存，超限的需要继续修改。',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ]
}

type MemoryAction = 'append' | 'settle_out' | 'settle_in' | 'forget'

const VALID_ACTIONS: string[] = ['append', 'settle_out', 'settle_in', 'forget']

const SETTLE_TARGETS: Record<string, RollingFile[]> = {
  identity: [],
  recent:   ['distant', 'lifetime'],
  distant:  ['lifetime'],
  lifetime: [],
}

const SETTLE_SOURCES: Record<string, RollingFile[]> = {
  identity: [],
  recent:   [],
  distant:  ['recent'],
  lifetime: ['recent', 'distant'],
}

function normalizeActions(raw: unknown): MemoryAction[] {
  if (Array.isArray(raw)) return raw.filter((a): a is MemoryAction => VALID_ACTIONS.includes(a as string))
  if (typeof raw === 'string' && VALID_ACTIONS.includes(raw)) return [raw as MemoryAction]
  return ['append']
}

function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  draft: Record<RollingFile, string>,
  committed: Set<RollingFile>,
  budgets: RollingBudgetConfig,
  lockedFiles: RollingFile[],
  fileActions: Map<RollingFile, Set<MemoryAction>>,
  modifiedFiles: Set<RollingFile>,
): { result: string; done: boolean } {
  const file = args.file as RollingFile | undefined
  const actions = normalizeActions(args.action)
  const reason = (args.reason as string | undefined) ?? ''
  const actionStr = actions.join('+')
  const writableFiles = ROLLING_FILE_NAMES.filter(f => !lockedFiles.includes(f))
  const lockMsg = (f: string) => `🔒 ${f} 本轮不可修改。信息流向：新事件→recent→distant→lifetime，只有前一层满了才向后沉淀。本轮可修改的文件：${writableFiles.join('/')}`

  if (name === 'read_memory') {
    if (!file || !ROLLING_FILE_NAMES.includes(file)) {
      return { result: `错误：file 必须是 ${ROLLING_FILE_NAMES.join('/')}`, done: false }
    }
    return { result: draft[file] || '（空文件）', done: false }
  }

  if (name === 'write_memory') {
    if (!file || !ROLLING_FILE_NAMES.includes(file)) {
      return { result: `错误：file 必须是 ${ROLLING_FILE_NAMES.join('/')}`, done: false }
    }
    if (lockedFiles.includes(file)) {
      log.debug('llm', `[rolling] BLOCKED write to locked file: ${file}`)
      return { result: lockMsg(file), done: false }
    }
    const targets = SETTLE_TARGETS[file] ?? []
    const allTargetsLocked = targets.length > 0 && targets.every(t => lockedFiles.includes(t))
    if (allTargetsLocked && draft[file].trim().length > 0) {
      log.warn('llm', `[rolling] BLOCKED write_memory on ${file}: file has content and settle targets locked — use edit_memory instead`)
      return { result: `错误：${file} 已有内容，且沉淀目标（${targets.join('/')}）本轮被锁定。为防止覆写导致记忆丢失，请改用 edit_memory 进行局部修改（追加新内容）。`, done: false }
    }
    if (committed.has(file)) {
      return { result: `${file} 已经提交通过，无需修改。`, done: false }
    }
    if (actions.includes('settle_out')) {
      if (targets.length > 0 && !targets.some(t => modifiedFiles.has(t))) {
        log.warn('llm', `[rolling] BLOCKED settle_out on ${file}: target files (${targets.join('/')}) not yet modified`)
        return { result: `错误：settle_out 顺序不对。你要从 ${file}（源层）沉淀内容出去，但目标层（${targets.join('/')}）还没有在本轮被修改过。沉淀必须先用 settle_in 写入目标层，再用 settle_out 从源层删减——请先把精简内容写入 ${targets.join(' 或 ')}，然后再回来从 ${file} 删减。`, done: false }
      }
    }
    if (actions.includes('forget') && file !== 'lifetime') {
      const hint = file === 'identity'
        ? '如需修正 identity 内容，请用 edit_memory 局部替换。'
        : `${file} 的内容如需清理，请通过 settle_out 沉淀到下游层，而不是直接丢弃。`
      log.warn('llm', `[rolling] BLOCKED forget on ${file}: only lifetime allows forget`)
      return { result: `错误：forget 只允许在 lifetime 上使用。${hint}`, done: false }
    }
    if (actions.includes('append') && file !== 'recent' && file !== 'identity') {
      log.warn('llm', `[rolling] BLOCKED append on ${file}: append only allowed on recent/identity`)
      return { result: `错误：append 只允许在 recent 和 identity 上使用。新信息只能写入 recent（或更新 identity），${file} 的内容只能通过 settle_in 从上游层沉淀而来。`, done: false }
    }
    const content = args.content as string ?? ''
    draft[file] = content
    modifiedFiles.add(file)
    if (!fileActions.has(file)) fileActions.set(file, new Set())
    for (const a of actions) fileActions.get(file)!.add(a)
    const logFn = actions.includes('forget') ? log.warn : log.info
    logFn('llm', `[rolling] write_memory ${file} [${actionStr}] ${estimateTokens(content)} tokens — ${reason}`)
    return { result: `已写入 ${file}（${estimateTokens(content)} tokens）[${actionStr}] ${reason}`, done: false }
  }

  if (name === 'edit_memory') {
    if (!file || !ROLLING_FILE_NAMES.includes(file)) {
      return { result: `错误：file 必须是 ${ROLLING_FILE_NAMES.join('/')}`, done: false }
    }
    if (lockedFiles.includes(file)) {
      log.debug('llm', `[rolling] BLOCKED edit to locked file: ${file}`)
      return { result: lockMsg(file), done: false }
    }
    if (committed.has(file)) {
      return { result: `${file} 已经提交通过，无需修改。`, done: false }
    }
    const targets = SETTLE_TARGETS[file] ?? []
    if (actions.includes('settle_out')) {
      if (targets.length > 0 && !targets.some(t => modifiedFiles.has(t))) {
        log.warn('llm', `[rolling] BLOCKED settle_out on ${file}: target files (${targets.join('/')}) not yet modified`)
        return { result: `错误：settle_out 顺序不对。你要从 ${file}（源层）沉淀内容出去，但目标层（${targets.join('/')}）还没有在本轮被修改过。沉淀必须先用 settle_in 写入目标层，再用 settle_out 从源层删减——请先把精简内容写入 ${targets.join(' 或 ')}，然后再回来从 ${file} 删减。`, done: false }
      }
    }
    if (actions.includes('forget') && file !== 'lifetime') {
      const hint = file === 'identity'
        ? '如需修正 identity 内容，请用 edit_memory 局部替换。'
        : `${file} 的内容如需清理，请通过 settle_out 沉淀到下游层，而不是直接丢弃。`
      log.warn('llm', `[rolling] BLOCKED forget on ${file}: only lifetime allows forget`)
      return { result: `错误：forget 只允许在 lifetime 上使用。${hint}`, done: false }
    }
    if (actions.includes('append') && file !== 'recent' && file !== 'identity') {
      log.warn('llm', `[rolling] BLOCKED append on ${file}: append only allowed on recent/identity`)
      return { result: `错误：append 只允许在 recent 和 identity 上使用。新信息只能写入 recent（或更新 identity），${file} 的内容只能通过 settle_in 从上游层沉淀而来。`, done: false }
    }
    const oldStr = args.old_str as string ?? ''
    const newStr = args.new_str as string ?? ''
    if (!draft[file].includes(oldStr)) {
      return { result: `错误：在 ${file} 中未找到要替换的文本。请用 read_memory 确认当前内容。`, done: false }
    }
    draft[file] = draft[file].replace(oldStr, newStr)
    modifiedFiles.add(file)
    if (!fileActions.has(file)) fileActions.set(file, new Set())
    for (const a of actions) fileActions.get(file)!.add(a)
    const logFn = actions.includes('forget') ? log.warn : log.info
    logFn('llm', `[rolling] edit_memory ${file} [${actionStr}] ${estimateTokens(draft[file])} tokens — ${reason}`)
    return { result: `已编辑 ${file}（${estimateTokens(draft[file])} tokens）[${actionStr}] ${reason}`, done: false }
  }

  if (name === 'commit_memory') {
    const settleErrors: string[] = []
    for (const [f, actions] of fileActions.entries()) {
      if (actions.has('settle_out')) {
        const targets = SETTLE_TARGETS[f] ?? []
        const hasTarget = targets.some(t => modifiedFiles.has(t))
        if (!hasTarget && targets.length > 0) {
          settleErrors.push(`${f} 标记了 settle_out，但目标层（${targets.join('/')}）未被修改。settle_out 要求目标层已通过 settle_in 接收内容。`)
        }
      }
      if (actions.has('settle_in')) {
        const sources = SETTLE_SOURCES[f] ?? []
        const hasSource = sources.some(s => {
          const sa = fileActions.get(s)
          return sa && sa.has('settle_out')
        })
        if (!hasSource && sources.length > 0) {
          settleErrors.push(`${f} 标记了 settle_in，但源层（${sources.join('/')}）没有对应的 settle_out。settle_in 和 settle_out 必须配对使用。`)
        }
      }
    }
    if (settleErrors.length > 0) {
      log.warn('llm', `[rolling] commit blocked by settle check: ${settleErrors.join(' | ')}`)
      return { result: `settle 校验失败：\n${settleErrors.join('\n')}`, done: false }
    }

    const results: string[] = []
    let allDone = true
    for (const f of ROLLING_FILE_NAMES) {
      if (committed.has(f)) {
        results.push(`${f}: skip（已提交）`)
        continue
      }
      const tokens = estimateTokens(draft[f])
      const limit = budgets[f].max_tokens
      if (tokens <= limit) {
        committed.add(f)
        results.push(`${f}: pass ✓（${tokens}/${limit} tokens）`)
      } else {
        results.push(`${f}: fail ✗（${tokens}/${limit} tokens，超出 ${tokens - limit} tokens，请精简）`)
        allDone = false
      }
    }
    log.info('llm', `[rolling] commit: ${results.join(' | ')}`)
    return { result: results.join('\n'), done: allDone }
  }

  return { result: `未知工具：${name}`, done: false }
}

async function callAnthropicRolling(
  config: LLMConfig,
  prompt: string,
  initialFiles: Record<RollingFile, string>,
  budgets: RollingBudgetConfig,
  maxTurns: number,
  traceId: string,
  lockedFiles: RollingFile[],
): Promise<RollingResult> {
  const client = new Anthropic({ apiKey: config.api_key, ...(config.base_url && { baseURL: config.base_url }) })
  const tools = buildRollingToolsAnthropic()
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft: Record<RollingFile, string> = { ...initialFiles }
    const committed = new Set<RollingFile>()
    const fileActions = new Map<RollingFile, Set<MemoryAction>>()
    const modifiedFiles = new Set<RollingFile>()
    const retryHint = attempt > 1 ? `\n\n⚠️ 这是第 ${attempt} 次尝试。上一次你没有成功 commit_memory 所有文件。请确保修改后调用 commit_memory 完成提交。` : ''

    log.debug('llm', `[anthropic-rolling] attempt ${attempt}/${MAX_ATTEMPTS}, prompt ${estimateTokens(prompt)} tokens`)
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt + retryHint }]

    for (let turn = 0; turn < maxTurns; turn++) {
      const msg = await retryOnTransient('anthropic-rolling', () => client.messages.create({
        model:      config.model_id,
        max_tokens: 4096,
        tools,
        messages,
      }))
      recordUsage({ input_tokens: msg.usage?.input_tokens ?? 0, output_tokens: msg.usage?.output_tokens ?? 0, model: config.model_id, task: 'rolling_update' }).catch(() => {})

      const toolBlocks = msg.content.filter(b => b.type === 'tool_use')
      if (toolBlocks.length === 0) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      let allDone = false

      for (const block of toolBlocks) {
        if (block.type !== 'tool_use') continue
        const args = (block.input ?? {}) as Record<string, unknown>
        const { result, done } = handleToolCall(block.name, args, draft, committed, budgets, lockedFiles, fileActions, modifiedFiles)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
        if (done) allDone = true
      }

      messages.push({ role: 'assistant', content: msg.content })
      messages.push({ role: 'user', content: toolResults })

      if (allDone) break
    }

    const requiredFiles = ROLLING_FILE_NAMES.filter(f => !lockedFiles.includes(f))
    const allCommitted = requiredFiles.every(f => committed.has(f))
    if (allCommitted) {
      const result = { identity: draft.identity, recent: draft.recent, distant: draft.distant, lifetime: draft.lifetime }
      await saveTrace('rolling', traceId, {
        provider: 'anthropic', model: config.model_id, attempt,
        messages,
        result: {
          identity: { tokens: estimateTokens(result.identity) },
          recent:   { tokens: estimateTokens(result.recent) },
          distant:  { tokens: estimateTokens(result.distant) },
          lifetime: { tokens: estimateTokens(result.lifetime) },
        },
      })
      return result
    }

    log.warn('llm', `[anthropic-rolling] attempt ${attempt} incomplete (committed: ${[...committed].join(',')}) — ${attempt < MAX_ATTEMPTS ? 'retrying from scratch' : 'falling back to force-truncate'}`)
  }

  log.warn('llm', `[anthropic-rolling] all ${MAX_ATTEMPTS} attempts failed, force-truncating`)
  const draft: Record<RollingFile, string> = { ...initialFiles }
  for (const f of ROLLING_FILE_NAMES) {
    const limit = budgets[f].max_tokens
    const maxChars = limit * CHARS_PER_TOKEN
    if (draft[f].length > maxChars) {
      const truncated = draft[f].slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      draft[f] = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `[rolling] force truncated ${f}: → ${estimateTokens(draft[f])} tokens`)
    }
  }
  return { identity: draft.identity, recent: draft.recent, distant: draft.distant, lifetime: draft.lifetime }
}

async function callOAICompletionRolling(
  config: LLMConfig,
  prompt: string,
  initialFiles: Record<RollingFile, string>,
  budgets: RollingBudgetConfig,
  maxTurns: number,
  traceId: string,
  lockedFiles: RollingFile[],
): Promise<RollingResult> {
  const client = new OpenAI({ apiKey: config.api_key ?? 'none', baseURL: config.base_url })

  const oaiTools: OpenAI.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'read_memory',
        description: '读取一个记忆文件的当前内容',
        parameters: {
          type: 'object',
          properties: { file: { type: 'string', enum: ROLLING_FILE_NAMES, description: '要读取的文件' } },
          required: ['file'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_memory',
        description: '覆写一个记忆文件的全部内容',
        parameters: {
          type: 'object',
          properties: {
            file:    { type: 'string', enum: ROLLING_FILE_NAMES },
            content: { type: 'string', description: '新的完整内容' },
            action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
            reason:  { type: 'string', description: '简述修改原因' },
          },
          required: ['file', 'content', 'action', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_memory',
        description: '局部编辑记忆文件',
        parameters: {
          type: 'object',
          properties: {
            file:    { type: 'string', enum: ROLLING_FILE_NAMES },
            old_str: { type: 'string' },
            new_str: { type: 'string' },
            action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
            reason:  { type: 'string', description: '简述修改原因' },
          },
          required: ['file', 'old_str', 'new_str', 'action', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'commit_memory',
        description: '提交修改并校验 token 上限',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ]

  log.debug('llm', `[oai-completion-rolling] prompt (${estimateTokens(prompt)} tokens)`)
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft: Record<RollingFile, string> = { ...initialFiles }
    const committed = new Set<RollingFile>()
    const fileActions = new Map<RollingFile, Set<MemoryAction>>()
    const modifiedFiles = new Set<RollingFile>()
    const retryHint = attempt > 1 ? `\n\n⚠️ 这是第 ${attempt} 次尝试。上一次你没有成功 commit_memory 所有文件。请确保修改后调用 commit_memory 完成提交。` : ''
    const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'user', content: prompt + retryHint }]

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await retryOnTransient('oai-completion-rolling', () => client.chat.completions.create({
        model: config.model_id,
        messages,
        tools: oaiTools,
      }))
      recordUsage({ input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0, model: config.model_id, task: 'rolling_update' }).catch(() => {})

      const choice = res.choices[0]
      if (!choice) break

      const toolCalls = choice.message?.tool_calls
      if (!toolCalls || toolCalls.length === 0) break

      messages.push(choice.message as OpenAI.ChatCompletionMessageParam)

      let allDone = false
      for (const tc of toolCalls) {
        if (tc.type !== 'function') continue
        const args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
        const { result, done } = handleToolCall(tc.function.name, args, draft, committed, budgets, lockedFiles, fileActions, modifiedFiles)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        if (done) allDone = true
      }

      if (allDone) break
    }

    const requiredFiles = ROLLING_FILE_NAMES.filter(f => !lockedFiles.includes(f))
    const allCommitted = requiredFiles.every(f => committed.has(f))
    if (allCommitted) {
      const oaiCompResult = { identity: draft.identity, recent: draft.recent, distant: draft.distant, lifetime: draft.lifetime }
      await saveTrace('rolling', traceId, {
        provider: 'oai-completion', model: config.model_id, attempt,
        messages,
        result: {
          identity: { tokens: estimateTokens(oaiCompResult.identity) },
          recent:   { tokens: estimateTokens(oaiCompResult.recent) },
          distant:  { tokens: estimateTokens(oaiCompResult.distant) },
          lifetime: { tokens: estimateTokens(oaiCompResult.lifetime) },
        },
      })
      return oaiCompResult
    }

    log.warn('llm', `[oai-completion-rolling] attempt ${attempt} incomplete (committed: ${[...committed].join(',')}) — ${attempt < MAX_ATTEMPTS ? 'retrying from scratch' : 'falling back to force-truncate'}`)
  }

  log.warn('llm', `[oai-completion-rolling] all ${MAX_ATTEMPTS} attempts failed, force-truncating`)
  const fallbackDraft: Record<RollingFile, string> = { ...initialFiles }
  for (const f of ROLLING_FILE_NAMES) {
    const limit = budgets[f].max_tokens
    const maxChars = limit * CHARS_PER_TOKEN
    if (fallbackDraft[f].length > maxChars) {
      const truncated = fallbackDraft[f].slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      fallbackDraft[f] = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `[rolling] force truncated ${f}: → ${estimateTokens(fallbackDraft[f])} tokens`)
    }
  }
  return { identity: fallbackDraft.identity, recent: fallbackDraft.recent, distant: fallbackDraft.distant, lifetime: fallbackDraft.lifetime }
}

async function callOAIResponseRolling(
  config: LLMConfig,
  prompt: string,
  initialFiles: Record<RollingFile, string>,
  budgets: RollingBudgetConfig,
  maxTurns: number,
  traceId: string,
  lockedFiles: RollingFile[],
): Promise<RollingResult> {
  const client = new OpenAI({ apiKey: config.api_key ?? 'none', baseURL: config.base_url })

  const oaiTools: OpenAI.Responses.FunctionTool[] = ROLLING_FILE_NAMES.length > 0 ? [
    {
      type: 'function',
      name: 'read_memory',
      description: '读取一个记忆文件的当前内容',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string', enum: ROLLING_FILE_NAMES } },
        required: ['file'],
      },
      strict: false,
    },
    {
      type: 'function',
      name: 'write_memory',
      description: '覆写一个记忆文件的全部内容',
      parameters: {
        type: 'object',
        properties: {
          file:    { type: 'string', enum: ROLLING_FILE_NAMES },
          content: { type: 'string' },
          action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
          reason:  { type: 'string', description: '简述修改原因' },
        },
        required: ['file', 'content', 'action', 'reason'],
      },
      strict: false,
    },
    {
      type: 'function',
      name: 'edit_memory',
      description: '局部编辑记忆文件',
      parameters: {
        type: 'object',
        properties: {
          file:    { type: 'string', enum: ROLLING_FILE_NAMES },
          old_str: { type: 'string' },
          new_str: { type: 'string' },
          action:  { type: 'array', items: { type: 'string', enum: ['append', 'settle_out', 'settle_in', 'forget'] }, description: '操作意图，可多选' },
          reason:  { type: 'string', description: '简述修改原因' },
        },
        required: ['file', 'old_str', 'new_str', 'action', 'reason'],
      },
      strict: false,
    },
    {
      type: 'function',
      name: 'commit_memory',
      description: '提交修改并校验 token 上限',
      parameters: { type: 'object', properties: {}, required: [] },
      strict: false,
    },
  ] : []

  log.debug('llm', `[oai-response-rolling] prompt (${estimateTokens(prompt)} tokens)`)
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft: Record<RollingFile, string> = { ...initialFiles }
    const committed = new Set<RollingFile>()
    const fileActions = new Map<RollingFile, Set<MemoryAction>>()
    const modifiedFiles = new Set<RollingFile>()
    const retryHint = attempt > 1 ? `\n\n⚠️ 这是第 ${attempt} 次尝试。上一次你没有成功 commit_memory 所有文件。请确保修改后调用 commit_memory 完成提交。` : ''
    let input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: prompt + retryHint }]

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await retryOnTransient('oai-response-rolling', () => client.responses.create({
        model: config.model_id,
        input,
        tools: oaiTools,
      }))
      recordUsage({ input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, model: config.model_id, task: 'rolling_update' }).catch(() => {})

      const fnCalls = res.output.filter(o => o.type === 'function_call')
      if (fnCalls.length === 0) break

      const newInputItems: OpenAI.Responses.ResponseInputItem[] = [
        ...fnCalls as OpenAI.Responses.ResponseInputItem[],
      ]

      let allDone = false
      for (const fc of fnCalls) {
        if (fc.type !== 'function_call') continue
        const args = JSON.parse(fc.arguments || '{}') as Record<string, unknown>
        const { result, done } = handleToolCall(fc.name, args, draft, committed, budgets, lockedFiles, fileActions, modifiedFiles)
        newInputItems.push({
          type: 'function_call_output' as const,
          call_id: fc.call_id,
          output: result,
        })
        if (done) allDone = true
      }

      input = [...input as OpenAI.Responses.ResponseInputItem[], ...newInputItems]

      if (allDone) break
    }

    const requiredFiles = ROLLING_FILE_NAMES.filter(f => !lockedFiles.includes(f))
    const allCommitted = requiredFiles.every(f => committed.has(f))
    if (allCommitted) {
      const oaiRespResult = { identity: draft.identity, recent: draft.recent, distant: draft.distant, lifetime: draft.lifetime }
      await saveTrace('rolling', traceId, {
        provider: 'oai-response', model: config.model_id, attempt,
        input,
        result: {
          identity: { tokens: estimateTokens(oaiRespResult.identity) },
          recent:   { tokens: estimateTokens(oaiRespResult.recent) },
          distant:  { tokens: estimateTokens(oaiRespResult.distant) },
          lifetime: { tokens: estimateTokens(oaiRespResult.lifetime) },
        },
      })
      return oaiRespResult
    }

    log.warn('llm', `[oai-response-rolling] attempt ${attempt} incomplete (committed: ${[...committed].join(',')}) — ${attempt < MAX_ATTEMPTS ? 'retrying from scratch' : 'falling back to force-truncate'}`)
  }

  log.warn('llm', `[oai-response-rolling] all ${MAX_ATTEMPTS} attempts failed, force-truncating`)
  const fallbackDraft: Record<RollingFile, string> = { ...initialFiles }
  for (const f of ROLLING_FILE_NAMES) {
    const limit = budgets[f].max_tokens
    const maxChars = limit * CHARS_PER_TOKEN
    if (fallbackDraft[f].length > maxChars) {
      const truncated = fallbackDraft[f].slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      fallbackDraft[f] = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `[rolling] force truncated ${f}: → ${estimateTokens(fallbackDraft[f])} tokens`)
    }
  }
  return { identity: fallbackDraft.identity, recent: fallbackDraft.recent, distant: fallbackDraft.distant, lifetime: fallbackDraft.lifetime }
}

async function callOAIResponseWithCompressAs(
  config: LLMConfig,
  prompt: string,
  layer: CompressAsInput['layer'],
  id: string,
  tokenLimit: number,
  maxRetries: number,
): Promise<CompressAsOutput & { title: string; content: string; flashbulb: boolean }> {
  const client = new OpenAI({
    apiKey:  config.api_key ?? 'none',
    baseURL: config.base_url,
  })

  const tool: OpenAI.Responses.FunctionTool = {
    type: 'function',
    name: 'compress_as',
    description: `Submit your compressed memory. Write as detailed and thorough as possible — capture all important context, causality, and outcomes. You MUST call this tool to submit your result.`,
    parameters: {
      type: 'object',
      properties: {
        title:     { type: 'string', description: 'A concise title for this session (under 50 chars)' },
        content:   { type: 'string', description: 'The compressed memory text' },
        flashbulb: { type: 'boolean', description: 'Mark as important memory' },
      },
      required: ['title', 'content'],
    },
    strict: false,
  }

  log.debug('llm', `[oai-response] prompt (${estimateTokens(prompt)} tokens):\n${prompt.slice(0, 500)}${prompt.length > 500 ? '...[truncated]' : ''}`)
  let input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: prompt }]
  let noToolRetried = false

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await retryOnTransient('oai-response', () => client.responses.create({
      model:       config.model_id,
      input,
      tools:       [tool],
      tool_choice: { type: 'function', name: 'compress_as' },
    }))
    recordUsage({ input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, model: config.model_id, task: 'session_compress' }).catch(() => {})

    const fnCall = res.output.find(o => o.type === 'function_call')
    if (!fnCall || fnCall.type !== 'function_call') {
      if (!noToolRetried) {
        log.warn('llm', `[oai-response] compress_as not called for ${layer}/${id}, output: ${JSON.stringify(res.output).slice(0, 500)}, retrying...`)
        noToolRetried = true
        input = [
          ...input as OpenAI.Responses.ResponseInputItem[],
          ...res.output as OpenAI.Responses.ResponseInputItem[],
          { role: 'user', content: '你必须调用 compress_as 工具来提交压缩结果，不能直接输出文本。请调用 compress_as 工具。' },
        ]
        continue
      }
      await saveTrace(`compress-${layer}-fail`, id, {
        provider: 'oai-response', model: config.model_id, layer, id, tokenLimit,
        error: 'no_tool_call', input,
        lastOutput: res.output,
      })
      throw new Error('LLM did not call compress_as tool (oai-response)')
    }

    const parsed = JSON.parse(fnCall.arguments) as { title?: string; content?: string; flashbulb?: boolean }
    if (!parsed?.content) {
      log.warn('llm', `[oai-response] compress_as returned empty content for ${layer}/${id}, args: ${fnCall.arguments.slice(0, 500)}, retrying...`)
      continue
    }
    const tokensUsed = estimateTokens(parsed.content)
    log.debug('llm', `[oai-response] compress_as called: tokens=${tokensUsed}/${tokenLimit} flashbulb=${parsed.flashbulb ?? false}\n${parsed.content}`)

    if (tokensUsed <= tokenLimit) {
      await saveTrace(`compress-${layer}`, id, {
        provider: 'oai-response', model: config.model_id, layer, id, tokenLimit,
        input,
        result: { content: parsed.content, flashbulb: parsed.flashbulb ?? false, tokens_used: tokensUsed },
      })
      return {
        success:      true,
        tokens_used:  tokensUsed,
        tokens_limit: tokenLimit,
        title:        parsed.title ?? '',
        content:      parsed.content,
        flashbulb:    parsed.flashbulb ?? false,
      }
    }

    if (attempt === maxRetries) {
      const maxChars = tokenLimit * CHARS_PER_TOKEN
      const truncated = parsed.content.slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      const finalContent = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `Force truncated ${layer}/${id}: ${tokensUsed} → ${estimateTokens(finalContent)} tokens (oai-response)`)
      await saveTrace(`compress-${layer}`, id, {
        provider: 'oai-response', model: config.model_id, layer, id, tokenLimit,
        input, forceTruncated: true,
        result: { content: finalContent, flashbulb: parsed.flashbulb ?? false, tokens_used: estimateTokens(finalContent) },
      })
      return {
        success:      true,
        tokens_used:  estimateTokens(finalContent),
        tokens_limit: tokenLimit,
        title:        parsed.title ?? '',
        content:      finalContent,
        flashbulb:    parsed.flashbulb ?? false,
      }
    }

    log.debug('llm', `Retry ${attempt + 1}/${maxRetries} for ${layer}/${id}: ${tokensUsed}/${tokenLimit} tokens (oai-response)`)
    input = [
      ...input as OpenAI.Responses.ResponseInputItem[],
      fnCall,
      {
        type: 'function_call_output' as const,
        call_id: fnCall.call_id,
        output: `错误：超出限制。当前 ${tokensUsed} tokens，上限 ${tokenLimit} tokens。请进一步压缩。`,
      },
    ]
  }

  await saveTrace(`compress-${layer}-fail`, id, {
    provider: 'oai-response', model: config.model_id, layer, id, tokenLimit,
    error: 'max_retries_exhausted', input,
  })
  throw new Error('Unreachable')
}

async function callOAICompletionWithCompressAs(
  config: LLMConfig,
  prompt: string,
  layer: CompressAsInput['layer'],
  id: string,
  tokenLimit: number,
  maxRetries: number,
): Promise<CompressAsOutput & { title: string; content: string; flashbulb: boolean }> {
  const client = new OpenAI({
    apiKey:  config.api_key ?? 'none',
    baseURL: config.base_url,
  })

  const openaiTool: OpenAI.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'compress_as',
      description: `Submit your compressed memory. Write as detailed and thorough as possible — capture all important context, causality, and outcomes. You MUST call this tool to submit your result.`,
      parameters: {
        type: 'object',
        properties: {
          title:     { type: 'string', description: 'A concise title for this session (under 50 chars)' },
          content:   { type: 'string', description: 'The compressed memory text' },
          flashbulb: { type: 'boolean', description: 'Mark as important memory' },
        },
        required: ['title', 'content'],
      },
    },
  }

  log.debug('llm', `[oai-completion] prompt (${estimateTokens(prompt)} tokens):\n${prompt.slice(0, 500)}${prompt.length > 500 ? '...[truncated]' : ''}`)
  const messages: OpenAI.ChatCompletionMessageParam[] = [{ role: 'user', content: prompt }]
  let noToolRetried = false

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await retryOnTransient('oai-completion', () => client.chat.completions.create({
      model:       config.model_id,
      messages,
      tools:       [openaiTool],
      tool_choice: { type: 'function', function: { name: 'compress_as' } },
    }))
    recordUsage({ input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0, model: config.model_id, task: 'session_compress' }).catch(() => {})

    const toolCall = res.choices[0]?.message?.tool_calls?.[0]
    if (!toolCall || toolCall.type !== 'function') {
      if (!noToolRetried) {
        log.warn('llm', `[oai-completion] compress_as not called for ${layer}/${id}, message: ${JSON.stringify(res.choices[0]?.message).slice(0, 500)}, retrying...`)
        noToolRetried = true
        const assistantMsg = res.choices[0]?.message
        if (assistantMsg) messages.push(assistantMsg as OpenAI.ChatCompletionMessageParam)
        messages.push({ role: 'user', content: '你必须调用 compress_as 工具来提交压缩结果，不能直接输出文本。请调用 compress_as 工具。' })
        continue
      }
      await saveTrace(`compress-${layer}-fail`, id, {
        provider: 'oai-completion', model: config.model_id, layer, id, tokenLimit,
        error: 'no_tool_call', messages,
        lastMessage: res.choices[0]?.message,
      })
      throw new Error('LLM did not call compress_as tool')
    }

    const input = JSON.parse(toolCall.function.arguments) as { title?: string; content?: string; flashbulb?: boolean }
    if (!input?.content) {
      log.warn('llm', `[oai-completion] compress_as returned empty content for ${layer}/${id}, args: ${toolCall.function.arguments.slice(0, 500)}, retrying...`)
      continue
    }
    const tokensUsed = estimateTokens(input.content)
    log.debug('llm', `[oai-completion] compress_as called: tokens=${tokensUsed}/${tokenLimit} flashbulb=${input.flashbulb ?? false}\n${input.content}`)

    if (tokensUsed <= tokenLimit) {
      await saveTrace(`compress-${layer}`, id, {
        provider: 'oai-completion', model: config.model_id, layer, id, tokenLimit,
        messages,
        result: { content: input.content, flashbulb: input.flashbulb ?? false, tokens_used: tokensUsed },
      })
      return {
        success:      true,
        tokens_used:  tokensUsed,
        tokens_limit: tokenLimit,
        title:        input.title ?? '',
        content:      input.content,
        flashbulb:    input.flashbulb ?? false,
      }
    }

    if (attempt === maxRetries) {
      const maxChars = tokenLimit * CHARS_PER_TOKEN
      const truncated = input.content.slice(0, maxChars)
      const lastBreak = Math.max(truncated.lastIndexOf('。'), truncated.lastIndexOf('\n'), truncated.lastIndexOf('.'))
      const finalContent = lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak + 1) : truncated
      log.warn('llm', `Force truncated ${layer}/${id}: ${tokensUsed} → ${estimateTokens(finalContent)} tokens (oai-completion)`)
      await saveTrace(`compress-${layer}`, id, {
        provider: 'oai-completion', model: config.model_id, layer, id, tokenLimit,
        messages, forceTruncated: true,
        result: { content: finalContent, flashbulb: input.flashbulb ?? false, tokens_used: estimateTokens(finalContent) },
      })
      return {
        success:      true,
        tokens_used:  estimateTokens(finalContent),
        tokens_limit: tokenLimit,
        title:        input.title ?? '',
        content:      finalContent,
        flashbulb:    input.flashbulb ?? false,
      }
    }

    log.debug('llm', `Retry ${attempt + 1}/${maxRetries} for ${layer}/${id}: ${tokensUsed}/${tokenLimit} tokens (oai-completion)`)
    messages.push(
      res.choices[0].message as OpenAI.ChatCompletionMessageParam,
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `错误：超出限制。当前 ${tokensUsed} tokens，上限 ${tokenLimit} tokens。请进一步压缩。`,
      }
    )
  }

  await saveTrace(`compress-${layer}-fail`, id, {
    provider: 'oai-completion', model: config.model_id, layer, id, tokenLimit,
    error: 'max_retries_exhausted', messages,
  })
  throw new Error('Unreachable')
}
