import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import * as p from '@clack/prompts'

const PLIST_LABEL = 'com.doramemory.daemon'
const PLIST_PATH  = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)

function nodePath(): string {
  try { return execSync('which node', { encoding: 'utf8' }).trim() } catch { return '/usr/local/bin/node' }
}

function cliEntryPath(): string {
  const dist = join(process.cwd(), 'dist', 'cli', 'index.js')
  if (existsSync(dist)) return dist
  try { return execSync('which doramemory', { encoding: 'utf8' }).trim() } catch { return dist }
}

function generatePlist(): string {
  const node = nodePath()
  const entry = cliEntryPath()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${entry}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.doramemory', 'launchd-stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.doramemory', 'launchd-stderr.log')}</string>
</dict>
</plist>`
}

function installLaunchd(): void {
  writeFileSync(PLIST_PATH, generatePlist(), 'utf8')
  execSync(`launchctl load -w ${PLIST_PATH}`)
  console.log(`✅ launchd 服务已安装并启动`)
  console.log(`   plist: ${PLIST_PATH}`)
  console.log(``)
  console.log(`   常用命令:`)
  console.log(`     npx doramemory status    — 查看 daemon 状态`)
  console.log(`     npx doramemory stop      — 停止 daemon`)
  console.log(`     npx doramemory start     — 手动启动 daemon`)
  console.log(`     npx doramemory refresh   — 手动刷新 MEMORY.md`)
  console.log(`     npx doramemory uninstall — 卸载守护服务`)
}

function installPm2(): void {
  const entry = cliEntryPath()
  try {
    execSync('which pm2', { encoding: 'utf8' })
  } catch {
    console.log('⚠️  pm2 未安装，请先运行: npm install -g pm2')
    return
  }
  execSync(`pm2 start ${entry} --name doramemory -- start`)
  try { execSync('pm2 save') } catch { /* ignore */ }
  console.log(`✅ pm2 进程已创建`)
  console.log(``)
  console.log(`   常用命令:`)
  console.log(`     npx doramemory status    — 查看 daemon 状态`)
  console.log(`     npx doramemory stop      — 停止 daemon`)
  console.log(`     npx doramemory start     — 手动启动 daemon`)
  console.log(`     npx doramemory refresh   — 手动刷新 MEMORY.md`)
  console.log(`     npx doramemory uninstall — 卸载守护服务`)
  console.log(`     pm2 logs doramemory      — 查看 pm2 日志`)
  console.log(`\n   设置开机自启: pm2 startup && pm2 save`)
}

export async function runInstall(): Promise<void> {
  const method = await p.select({
    message: '选择进程守护方式',
    options: [
      { value: 'launchd', label: 'launchd (macOS 原生，推荐)' },
      { value: 'pm2',     label: 'pm2 (跨平台，需要全局安装)' },
      { value: 'none',    label: '不安装，我自己手动管理' },
    ],
  })

  if (p.isCancel(method) || method === 'none') {
    console.log('已跳过。你可以用 npx doramemory start 手动启动。')
    return
  }

  if (method === 'launchd') installLaunchd()
  else if (method === 'pm2') installPm2()
}

export async function runUninstall(): Promise<void> {
  let removed = false

  if (existsSync(PLIST_PATH)) {
    try { execSync(`launchctl unload -w ${PLIST_PATH}`) } catch { /* ignore */ }
    unlinkSync(PLIST_PATH)
    console.log(`✅ launchd 服务已卸载 (${PLIST_PATH})`)
    removed = true
  }

  try {
    execSync('pm2 describe doramemory', { stdio: 'pipe' })
    execSync('pm2 delete doramemory')
    try { execSync('pm2 save') } catch { /* ignore */ }
    console.log('✅ pm2 进程已删除')
    removed = true
  } catch { /* pm2 not installed or no such process */ }

  if (!removed) {
    console.log('未检测到已安装的守护服务。')
  }
}
