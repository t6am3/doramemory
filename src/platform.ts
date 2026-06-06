import { homedir } from 'os'
import { join } from 'path'

export function expandUserPath(value: string): string {
  let expanded = value.replace(/^~(?=$|[/\\])/, homedir())

  expanded = expanded.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([^%]+)%/g, (match, braced, unixName, winName) => {
    const name = braced ?? unixName ?? winName
    return process.env[name] ?? match
  })

  return expanded
}

export function normalizePathForMatching(value: string): string {
  return value.replace(/\\/g, '/')
}

export function npmBinary(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

export function claudeMcpConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'Claude', 'claude_desktop_config.json')
  }

  return join(homedir(), '.claude', 'claude_desktop_config.json')
}
