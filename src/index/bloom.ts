import { BloomFilter } from 'bloom-filters'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { BLOOM_FILE } from '../storage/paths.js'

const FALSE_POSITIVE_RATE = 0.01
const INITIAL_CAPACITY = 100_000

let filter: BloomFilter | null = null

function getFilter(): BloomFilter {
  if (!filter) {
    filter = BloomFilter.create(INITIAL_CAPACITY, FALSE_POSITIVE_RATE)
  }
  return filter
}

export async function loadBloom(): Promise<void> {
  if (!existsSync(BLOOM_FILE)) return
  try {
    const data = await readFile(BLOOM_FILE, 'utf8')
    filter = BloomFilter.fromJSON(JSON.parse(data))
  } catch {
    filter = BloomFilter.create(INITIAL_CAPACITY, FALSE_POSITIVE_RATE)
  }
}

export async function saveBloom(): Promise<void> {
  await writeFile(BLOOM_FILE, JSON.stringify(getFilter().saveAsJSON()), 'utf8')
}

export function hasMessageId(id: string): boolean {
  return getFilter().has(id)
}

export function addMessageId(id: string): void {
  getFilter().add(id)
}
