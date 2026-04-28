import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { DORA_HOME, toLocalDate } from '../storage/paths.js'

export const USAGE_FILE = join(DORA_HOME, 'usage.json')

export type UsageTask = 'session_compress' | 'rolling_update'

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  model: string
  task: UsageTask
}

interface Stats {
  input_tokens: number
  output_tokens: number
  requests: number
}

export interface UsageRecord {
  total: Stats
  by_model: Record<string, Stats>
  by_task: Record<string, Stats>
  by_date: Record<string, {
    total: Stats
    by_model: Record<string, Stats>
    by_task: Record<string, Stats>
  }>
}

function emptyStats(): Stats {
  return { input_tokens: 0, output_tokens: 0, requests: 0 }
}

function emptyRecord(): UsageRecord {
  return { total: emptyStats(), by_model: {}, by_task: {}, by_date: {} }
}

function addTo(target: Stats, input: number, output: number): void {
  target.input_tokens += input
  target.output_tokens += output
  target.requests += 1
}

function ensure(map: Record<string, Stats>, key: string): Stats {
  if (!map[key]) map[key] = emptyStats()
  return map[key]
}

export async function loadUsage(): Promise<UsageRecord> {
  if (!existsSync(USAGE_FILE)) return emptyRecord()
  try {
    const raw = await readFile(USAGE_FILE, 'utf8')
    return JSON.parse(raw) as UsageRecord
  } catch {
    return emptyRecord()
  }
}

export async function recordUsage(usage: TokenUsage): Promise<void> {
  const record = await loadUsage()
  const today = toLocalDate()
  const { input_tokens, output_tokens, model, task } = usage

  addTo(record.total, input_tokens, output_tokens)
  addTo(ensure(record.by_model, model), input_tokens, output_tokens)
  addTo(ensure(record.by_task, task), input_tokens, output_tokens)

  if (!record.by_date[today]) {
    record.by_date[today] = { total: emptyStats(), by_model: {}, by_task: {} }
  }
  const day = record.by_date[today]
  addTo(day.total, input_tokens, output_tokens)
  addTo(ensure(day.by_model, model), input_tokens, output_tokens)
  addTo(ensure(day.by_task, task), input_tokens, output_tokens)

  await mkdir(dirname(USAGE_FILE), { recursive: true })
  await writeFile(USAGE_FILE, JSON.stringify(record, null, 2), 'utf8')
}
