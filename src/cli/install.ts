import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import * as p from '@clack/prompts'
import { npmBinary } from '../platform.js'

const PLIST_LABEL = 'com.doramemory.daemon'
const PLIST_PATH  = join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)

type InstallMethod = 'launchd' | 'pm2' | 'none'
type CommandStdio = 'inherit' | 'ignore'

function nodePath(): string {
  return process.execPath
}

function cliEntryPath(): string {
  const moduleEntry = fileURLToPath(new URL('index.js', import.meta.url))
  if (existsSync(moduleEntry)) return moduleEntry

  const dist = join(process.cwd(), 'dist', 'cli', 'index.js')
  if (existsSync(dist)) return dist

  const invoked = process.argv[1]
  if (invoked && existsSync(invoked)) return invoked

  return moduleEntry
}

function quoteCmdArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[ \t&()^|<>"]/u.test(arg)) return arg
  return `"${arg.replace(/(["^&()|<>])/g, '^$1')}"`
}

function runCommand(command: string, args: string[], stdio: CommandStdio = 'inherit'): void {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    const line = [command, ...args].map(quoteCmdArg).join(' ')
    execFileSync(shell, ['/d', '/s', '/c', line], { stdio })
    return
  }

  execFileSync(command, args, { stdio })
}

function commandExists(command: string): boolean {
  try {
    runCommand(command, ['--version'], 'ignore')
    return true
  } catch {
    return false
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function generatePlist(): string {
  const node = escapeXml(nodePath())
  const entry = escapeXml(cliEntryPath())
  const stdout = escapeXml(join(homedir(), '.doramemory', 'launchd-stdout.log'))
  const stderr = escapeXml(join(homedir(), '.doramemory', 'launchd-stderr.log'))

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
  <string>${stdout}</string>
  <key>StandardErrorPath</key>
  <string>${stderr}</string>
</dict>
</plist>`
}

function installLaunchd(): void {
  if (process.platform !== 'darwin') {
    console.log('launchd 只支持 macOS。Windows/Linux 请使用 pm2 或手动管理。')
    return
  }

  mkdirSync(dirname(PLIST_PATH), { recursive: true })
  writeFileSync(PLIST_PATH, generatePlist(), 'utf8')
  runCommand('launchctl', ['load', '-w', PLIST_PATH])
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
  const pm2 = npmBinary('pm2')

  if (!commandExists(pm2)) {
    console.log('⚠️  pm2 未安装，请先运行: npm install -g pm2')
    return
  }

  runCommand(pm2, ['start', entry, '--name', 'doramemory', '--', 'start'])
  try { runCommand(pm2, ['save']) } catch { /* ignore */ }
  console.log(`✅ pm2 进程已创建`)
  console.log(``)
  console.log(`   常用命令:`)
  console.log(`     npx doramemory status    — 查看 daemon 状态`)
  console.log(`     npx doramemory stop      — 停止 daemon`)
  console.log(`     npx doramemory start     — 手动启动 daemon`)
  console.log(`     npx doramemory refresh   — 手动刷新 MEMORY.md`)
  console.log(`     npx doramemory uninstall — 卸载守护服务`)
  console.log(`     pm2 logs doramemory      — 查看 pm2 日志`)
  if (process.platform === 'win32') {
    console.log(`\n   Windows 开机自启: 可安装 pm2-windows-startup 后执行 pm2-startup install`)
  } else {
    console.log(`\n   设置开机自启: pm2 startup && pm2 save`)
  }
}

function installOptions(): Array<{ value: InstallMethod; label: string }> {
  const options: Array<{ value: InstallMethod; label: string }> = []

  if (process.platform === 'darwin') {
    options.push({ value: 'launchd', label: 'launchd (macOS 原生，推荐)' })
  }

  const pm2Label = process.platform === 'win32'
    ? 'pm2 (Windows/跨平台，推荐)'
    : 'pm2 (跨平台，需要全局安装)'
  options.push({ value: 'pm2', label: pm2Label })
  options.push({ value: 'none', label: '不安装，我自己手动管理' })

  return options
}

export async function runInstall(): Promise<void> {
  const method = await p.select({
    message: '选择进程守护方式',
    options: installOptions(),
  }) as InstallMethod | symbol

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
    if (process.platform === 'darwin') {
      try { runCommand('launchctl', ['unload', '-w', PLIST_PATH]) } catch { /* ignore */ }
    }
    unlinkSync(PLIST_PATH)
    console.log(`✅ launchd 服务已卸载 (${PLIST_PATH})`)
    removed = true
  }

  const pm2 = npmBinary('pm2')
  try {
    runCommand(pm2, ['describe', 'doramemory'], 'ignore')
    runCommand(pm2, ['delete', 'doramemory'])
    try { runCommand(pm2, ['save']) } catch { /* ignore */ }
    console.log('✅ pm2 进程已删除')
    removed = true
  } catch { /* pm2 not installed or no such process */ }

  if (!removed) {
    console.log('未检测到已安装的守护服务。')
  }
}
