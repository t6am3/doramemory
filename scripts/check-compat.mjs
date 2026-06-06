import assert from 'node:assert/strict'

const originalPlatform = process.platform
const bs = String.fromCharCode(92)

const platform = await import('../dist/platform.js')
const openclaw = await import('../dist/parsers/openclaw.js')
const watcher = await import('../dist/daemon/watcher.js')

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function winPath(...parts) {
  return parts.join(bs)
}

function normalize(value) {
  return value.replace(/\\/g, '/')
}

function checkCurrentPlatform() {
  const isWindows = originalPlatform === 'win32'
  assert.equal(platform.npmBinary('npx'), isWindows ? 'npx.cmd' : 'npx')
  assert.equal(platform.npmBinary('pm2'), isWindows ? 'pm2.cmd' : 'pm2')

  const mcpPath = normalize(platform.claudeMcpConfigPath())
  const expectedSuffix = isWindows
    ? 'Claude/claude_desktop_config.json'
    : '.claude/claude_desktop_config.json'
  assert.ok(mcpPath.endsWith(expectedSuffix), mcpPath)
}

function checkWindowsSimulation() {
  setPlatform('win32')
  process.env.APPDATA = 'C:\\Users\\you\\AppData\\Roaming'
  process.env.USERPROFILE = 'C:\\Users\\you'

  assert.equal(platform.npmBinary('npx'), 'npx.cmd')
  assert.equal(platform.npmBinary('pm2'), 'pm2.cmd')
  assert.equal(
    normalize(platform.claudeMcpConfigPath()),
    'C:/Users/you/AppData/Roaming/Claude/claude_desktop_config.json',
  )
  assert.equal(
    platform.expandUserPath('%USERPROFILE%\\.doramemory\\config.yaml'),
    'C:\\Users\\you\\.doramemory\\config.yaml',
  )

  const uuid = '123e4567-e89b-12d3-a456-426614174000'
  const openclawFile = winPath('C:', 'Users', 'you', '.openclaw', 'agents', 'nobita', 'sessions', `${uuid}.jsonl`)
  const openclawOther = winPath('C:', 'Users', 'you', '.openclaw', 'agents', 'nobita', 'sessions', 'abc.jsonl')
  const claudeFile = winPath('C:', 'Users', 'you', '.claude', 'projects', '-Users-you-projects-doramemory', 'abc.jsonl')

  assert.equal(openclaw.deriveSessionId(openclawFile), '123e4567')
  assert.equal(watcher.inferProject(openclawOther, 'openclaw'), 'openclaw-nobita')
  assert.equal(watcher.inferProject(claudeFile, 'claude'), 'claude-code-doramemory')
  assert.equal(platform.normalizePathForMatching(winPath('C:', 'Users', 'you')), 'C:/Users/you')
}

try {
  checkCurrentPlatform()
  checkWindowsSimulation()
} finally {
  setPlatform(originalPlatform)
}

console.log('compat checks passed')
