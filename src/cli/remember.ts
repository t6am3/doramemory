import { readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import yaml from 'js-yaml'
import { LAYER_DIRS, ensureDirectories } from '../storage/paths.js'
import { parseMemoryFile } from '../storage/utils.js'
import type { MemoryFrontmatter, MemoryLayer } from '../types.js'

function printUsage(): void {
  console.log(
    'Usage:\n' +
    '  npx doramemory remember <memory_id> --layer session --flashbulb      — 标记为重要记忆\n' +
    '  npx doramemory remember <memory_id> --layer session --no-flashbulb   — 取消重要标记\n' +
    '  npx doramemory remember <memory_id> --layer session --content "修正" — 修正摘要内容\n'
  )
}

const VALID_LAYERS: MemoryLayer[] = ['second', 'session']
const EDITABLE_LAYERS: MemoryLayer[] = ['session']

export async function runRemember(args: string[]): Promise<void> {
  let memoryId: string | undefined
  let layer: MemoryLayer | undefined
  let flashbulb: boolean | undefined
  let content: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--layer':
      case '-l':
        layer = args[++i] as MemoryLayer
        break
      case '--flashbulb':
      case '-f':
        flashbulb = true
        break
      case '--no-flashbulb':
        flashbulb = false
        break
      case '--content':
      case '-c':
        content = args[++i]
        break
      case '--help':
      case '-h':
        printUsage()
        return
      default:
        if (!args[i].startsWith('-') && !memoryId) {
          memoryId = args[i]
        }
    }
  }

  if (!memoryId || !layer) {
    printUsage()
    return
  }

  if (!VALID_LAYERS.includes(layer)) {
    console.log(JSON.stringify({ error: `无效的 layer: ${layer}，可选: ${VALID_LAYERS.join(', ')}` }))
    return
  }

  if (content && !EDITABLE_LAYERS.includes(layer)) {
    console.log(JSON.stringify({ error: `${layer} 层的内容不可编辑，仅 ${EDITABLE_LAYERS.join('/')} 层可修正内容` }))
    return
  }

  if (flashbulb === undefined && content === undefined) {
    console.log(JSON.stringify({ error: '请指定 --flashbulb / --no-flashbulb 或 --content' }))
    return
  }

  await ensureDirectories()

  const layerDir = LAYER_DIRS[layer]
  const files = await readdir(layerDir).catch(() => [] as string[])
  const file = files.find(f => f.includes(memoryId!))

  if (!file) {
    console.log(JSON.stringify({ error: `在 ${layer} 层中未找到 ${memoryId}` }))
    return
  }

  const filePath = join(layerDir, file)
  const raw = await readFile(filePath, 'utf8')
  const { frontmatter, body } = parseMemoryFile(raw)

  if (flashbulb !== undefined) frontmatter.flashbulb = flashbulb
  const newBody = content ?? body

  await writeFile(
    filePath,
    `---\n${yaml.dump(frontmatter)}---\n\n${newBody}\n`,
    'utf8'
  )

  const changes: string[] = []
  if (flashbulb !== undefined) changes.push(`flashbulb=${flashbulb}`)
  if (content !== undefined) changes.push('content_updated')

  console.log(JSON.stringify({
    success: true,
    file: file,
    file_path: filePath,
    changes,
    flashbulb: frontmatter.flashbulb,
  }))
}
