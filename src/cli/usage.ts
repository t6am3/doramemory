import { loadUsage } from '../llm/usage.js'

const TASK_LABELS: Record<string, string> = {
  session_compress: '会话压缩',
  rolling_update: '滚动更新',
}

export async function runUsage(args: string[]): Promise<void> {
  const record = await loadUsage()
  const byIdx = args.indexOf('--by')
  const dimension = byIdx !== -1 ? args[byIdx + 1] : undefined

  if (dimension === 'model') {
    const rows = Object.entries(record.by_model).map(([model, s]) => ({
      model,
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      total_tokens: s.input_tokens + s.output_tokens,
      requests: s.requests,
    }))
    console.log(JSON.stringify({ by_model: rows, total: summarize(record.total) }, null, 2))
    return
  }

  if (dimension === 'date') {
    const rows = Object.entries(record.by_date)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, d]) => ({
        date,
        input_tokens: d.total.input_tokens,
        output_tokens: d.total.output_tokens,
        total_tokens: d.total.input_tokens + d.total.output_tokens,
        requests: d.total.requests,
      }))
    console.log(JSON.stringify({ by_date: rows, total: summarize(record.total) }, null, 2))
    return
  }

  if (dimension === 'task') {
    const rows = Object.entries(record.by_task).map(([task, s]) => ({
      task,
      label: TASK_LABELS[task] ?? task,
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      total_tokens: s.input_tokens + s.output_tokens,
      requests: s.requests,
    }))
    console.log(JSON.stringify({ by_task: rows, total: summarize(record.total) }, null, 2))
    return
  }

  console.log(JSON.stringify({
    total: summarize(record.total),
    by_model: record.by_model,
    by_task: record.by_task,
    by_date: Object.fromEntries(
      Object.entries(record.by_date)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 7)
        .map(([date, d]) => [date, { ...d.total, by_model: d.by_model, by_task: d.by_task }])
    ),
  }, null, 2))
}

function summarize(s: { input_tokens: number; output_tokens: number; requests: number }) {
  return {
    input_tokens: s.input_tokens,
    output_tokens: s.output_tokens,
    total_tokens: s.input_tokens + s.output_tokens,
    requests: s.requests,
  }
}
