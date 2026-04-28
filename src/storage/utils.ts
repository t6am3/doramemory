import yaml from 'js-yaml'
import type { MemoryFrontmatter } from '../types.js'

export function parseMemoryFile(raw: string): { frontmatter: MemoryFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return { frontmatter: {} as MemoryFrontmatter, body: raw.trim() }
  return {
    frontmatter: yaml.load(match[1]) as MemoryFrontmatter,
    body: match[2].trim(),
  }
}
