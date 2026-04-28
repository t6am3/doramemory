import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { LAYER_DIRS } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'

function printUsage(): void {
  console.log(
    'Usage:\n' +
    '  npx doramemory sessions --from "2026-04-10T05:00:00Z"              — 查看该时间后新增/更新的会话\n' +
    '  npx doramemory sessions --from "..." --to "2026-04-10T12:00:00Z"   — 限定时间范围\n' +
    '  npx doramemory sessions --from "..." --by time                     — 按会话发生时间筛选（默认 compressed）\n' +
    '  npx doramemory sessions --from "..." --project claude-code-doramemory  — 只返回指定角色的会话\n' +
    '  npx doramemory sessions --from "..." --exclude "feb2e7"            — 排除指定 session\n' +
    '  npx doramemory sessions --from "..." --exclude "feb2e7,abc123"     — 排除多个 session\n' +
    '  npx doramemory sessions --from "..." --max 5                       — 每页最多返回 N 条（默认 5）\n' +
    '  npx doramemory sessions --from "..." --offset 5                    — 分页偏移\n' +
    '\n' +
    '--by 选项：\n' +
    '  compressed  （默认）按压缩执行时间 compressed_at 筛选，适合增量拉取新会话\n' +
    '  time        按会话发生时间（id 中的日期）筛选，适合查询特定时间段的历史\n'
  )
}

function parseArg(args: string[], i: number, arg: string, prefix: string): { value: string; nextI: number } | null {
  if (arg === prefix) return { value: args[i + 1] ?? '', nextI: i + 1 }
  if (arg.startsWith(prefix + '=')) return { value: arg.slice(prefix.length + 1), nextI: i }
  return null
}

function extractIdTime(id: string): Date | null {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(`${m[1]}T${m[2]}:00:00Z`)
}

export async function runSessions(args: string[]): Promise<void> {
  let from: string | undefined
  let to: string | undefined
  let by: 'compressed' | 'time' = 'compressed'
  let projectFilter: string | undefined
  let exclude: string[] = []
  let max = 5
  let offset = 0

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') { printUsage(); return }

    let parsed = parseArg(args, i, arg, '--from')
    if (parsed) { from = parsed.value; i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '--to')
    if (parsed) { to = parsed.value; i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '--by')
    if (parsed) {
      const v = parsed.value.toLowerCase()
      if (v === 'time' || v === 'compressed') by = v
      i = parsed.nextI
      continue
    }

    parsed = parseArg(args, i, arg, '--project')
    if (parsed) { projectFilter = parsed.value; i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '--exclude')
    if (parsed) { exclude = parsed.value.split(',').map(s => s.trim()).filter(Boolean); i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '--max')
    if (parsed) { max = parseInt(parsed.value, 10) || 5; i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '-n')
    if (parsed) { max = parseInt(parsed.value, 10) || 5; i = parsed.nextI; continue }

    parsed = parseArg(args, i, arg, '--offset')
    if (parsed) { offset = parseInt(parsed.value, 10) || 0; i = parsed.nextI; continue }
  }

  if (!from) {
    printUsage()
    return
  }

  const fromDate = new Date(from)
  if (isNaN(fromDate.getTime())) {
    console.error(JSON.stringify({ error: `Invalid --from timestamp: ${from}` }))
    process.exitCode = 1
    return
  }

  const toDate = to ? new Date(to) : null
  if (to && (!toDate || isNaN(toDate.getTime()))) {
    console.error(JSON.stringify({ error: `Invalid --to timestamp: ${to}` }))
    process.exitCode = 1
    return
  }

  const files = await readdir(LAYER_DIRS.session).catch(() => [] as string[])
  const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse()

  type SessionEntry = {
    id: string
    file: string
    session_id: string
    title: string
    time: string
    flashbulb: boolean
    compressed_at: string
    project?: string
    body: string
  }

  const allMatched: SessionEntry[] = []

  for (const f of mdFiles) {
    const id = f.replace('.md', '')

    const excludeMatch = exclude.some(ex => id.includes(ex))
    if (excludeMatch) continue

    if (by === 'time') {
      const idTime = extractIdTime(id)
      if (!idTime) continue
      if (idTime <= fromDate) continue
      if (toDate && idTime > toDate) continue
    }

    const filePath = join(LAYER_DIRS.session, f)
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseMemoryFile(raw)

    const compressedAt = frontmatter.compressed_at
    if (!compressedAt) continue

    if (projectFilter && frontmatter.project !== projectFilter) continue

    if (by === 'compressed') {
      const compressedDate = new Date(compressedAt)
      if (compressedDate <= fromDate) continue
      if (toDate && compressedDate > toDate) continue
    }

    const timeLabel = formatSessionTime(id)

    allMatched.push({
      id,
      file: filePath,
      session_id: frontmatter.session_id ?? '',
      title: frontmatter.title ?? '',
      time: timeLabel,
      flashbulb: frontmatter.flashbulb ?? false,
      compressed_at: compressedAt,
      project: frontmatter.project,
      body,
    })
  }

  const total = allMatched.length
  const paged = allMatched.slice(offset, offset + max)
  const hasMore = offset + max < total
  const now = new Date().toISOString()

  console.log(JSON.stringify({
    sessions: paged,
    returned: paged.length,
    total,
    has_more: hasMore,
    offset,
    by,
    now,
  }, null, 2))
}

function formatSessionTime(id: string): string {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})-([a-f0-9]+?)(-partial)?$/)
  if (m) {
    const label = `${m[1].slice(5)} ${m[2]}:00 [${m[3]}]`
    return m[4] ? `${label} (进行中)` : label
  }
  return id
}
