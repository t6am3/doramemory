#!/usr/bin/env node
/**
 * Migrates old per-message .md files in second/ to hourly .jsonl files.
 * Usage: node scripts/migrate-second-to-jsonl.mjs [--dry-run]
 */
import { readdir, readFile, writeFile, rename, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'

const DORA_HOME = process.env.DORAMEMORY_HOME ?? join(homedir(), '.doramemory')
const SECOND_DIR = join(DORA_HOME, 'second')
const BACKUP_DIR = join(DORA_HOME, 'second_old')
const DRY_RUN = process.argv.includes('--dry-run')

function parseMemoryFile(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/)
  if (!match) return null
  return {
    frontmatter: yaml.load(match[1]),
    body: match[2],
  }
}

function extractRole(body) {
  const match = body.match(/^\[(user|assistant|tool)/)
  return match ? match[1] : 'user'
}

function extractContent(body) {
  const match = body.match(/^\[.*?\]\n\n([\s\S]*)$/)
  return match ? match[1].trim() : body.trim()
}

function timestampToHourKey(timestamp) {
  const d = new Date(timestamp)
  const date = d.toISOString().slice(0, 10)
  const hour = String(d.getUTCHours()).padStart(2, '0')
  return `${date}T${hour}`
}

async function main() {
  const files = await readdir(SECOND_DIR)
  const mdFiles = files.filter(f => f.endsWith('.md')).sort()

  if (mdFiles.length === 0) {
    console.log('No .md files found in second/ — nothing to migrate.')
    return
  }

  console.log(`Found ${mdFiles.length} .md files to migrate.`)
  if (DRY_RUN) console.log('(dry-run mode — no files will be written)')

  const hourGroups = new Map()
  let parsed = 0
  let skipped = 0

  for (const f of mdFiles) {
    const raw = await readFile(join(SECOND_DIR, f), 'utf8')
    const result = parseMemoryFile(raw)
    if (!result) {
      console.warn(`  SKIP (parse failed): ${f}`)
      skipped++
      continue
    }

    const { frontmatter, body } = result
    const entry = {
      id:         frontmatter.id,
      session_id: frontmatter.session_id ?? '_unknown',
      role:       extractRole(body),
      timestamp:  frontmatter.timestamp ?? '',
      content:    extractContent(body),
      flashbulb:  frontmatter.flashbulb ?? false,
    }

    const hourKey = timestampToHourKey(entry.timestamp)
    if (!hourGroups.has(hourKey)) hourGroups.set(hourKey, [])
    hourGroups.get(hourKey).push(entry)
    parsed++
  }

  console.log(`Parsed: ${parsed}, Skipped: ${skipped}, Hour groups: ${hourGroups.size}`)

  if (DRY_RUN) {
    for (const [hour, entries] of hourGroups) {
      console.log(`  ${hour}.jsonl — ${entries.length} entries`)
    }
    return
  }

  // Write JSONL files
  for (const [hour, entries] of hourGroups) {
    const outFile = join(SECOND_DIR, `${hour}.jsonl`)
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(outFile, content, 'utf8')
    console.log(`  Wrote ${outFile} (${entries.length} entries)`)
  }

  // Move old .md files to backup
  await mkdir(BACKUP_DIR, { recursive: true })
  for (const f of mdFiles) {
    await rename(join(SECOND_DIR, f), join(BACKUP_DIR, f))
  }
  console.log(`\nMoved ${mdFiles.length} .md files to ${BACKUP_DIR}/`)
  console.log('Migration complete! You can delete second_old/ after verifying.')
}

main().catch(err => { console.error(err); process.exit(1) })
