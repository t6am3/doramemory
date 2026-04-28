import { recall } from '../memory/recall.js'
import { ensureDirectories } from '../storage/paths.js'

function printUsage(): void {
  console.log(
    'Usage:\n' +
    '  npx doramemory recall --query "关键词"             — 关键词搜索\n' +
    '  npx doramemory recall --from 2026-04-07            — 按时间查询\n' +
    '  npx doramemory recall --query "xxx" --max 3        — 最多返回 N 条\n' +
    '  npx doramemory recall --query "xxx" --offset 5     — 分页偏移\n'
  )
}

export async function runRecall(args: string[]): Promise<void> {
  let query: string | undefined
  let from: string | undefined
  let to: string | undefined
  let maxResults = 5
  let offset = 0

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--query':
      case '-q':
        query = args[++i]
        break
      case '--from':
        from = args[++i]
        break
      case '--to':
        to = args[++i]
        break
      case '--max':
      case '-n':
        maxResults = parseInt(args[++i], 10)
        break
      case '--offset':
        offset = parseInt(args[++i], 10)
        break
      case '--help':
      case '-h':
        printUsage()
        return
    }
  }

  if (!query && !from) {
    printUsage()
    return
  }

  await ensureDirectories()

  const result = await recall({
    query,
    time_range: from ? { from, to } : undefined,
    max_results: maxResults,
    offset,
  })

  if (result.chunks.length === 0) {
    console.log(JSON.stringify({ chunks: [], returned: 0, total_candidates: result.total_candidates, has_more: false }))
    return
  }

  const output = {
    chunks: result.chunks.map(c => ({
      layer:      c.layer,
      id:         c.id,
      summary:    c.summary,
      snippet:    c.snippet,
      score:      Math.round(c.score * 100) / 100,
      match_type: c.match_type,
      flashbulb:  c.flashbulb,
      file_path:  c.file_path,
      size:       c.size,
    })),
    returned: result.chunks.length,
    total_candidates: result.total_candidates,
    has_more: result.has_more,
    offset,
  }

  console.log(JSON.stringify(output, null, 2))
}
