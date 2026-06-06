#!/usr/bin/env node
import { runInit } from './init.js'
import { startDaemon } from '../daemon/index.js'
import { startMcpServer } from '../mcp/server.js'
import { runCompress } from './compress.js'
import { runRecall } from './recall.js'
import { runRemember } from './remember.js'
import { runInstall, runUninstall } from './install.js'
import { runStop } from './stop.js'
import { runStatus } from './status.js'
import { runUsage } from './usage.js'
import { runSessions } from './sessions.js'
import { runRefresh } from './refresh.js'
import { runInject } from './inject.js'

const command = process.argv[2]

switch (command) {
  case 'init':
    runInit(process.argv.slice(3)).catch(console.error)
    break

  case 'start':
    startDaemon().catch(console.error)
    break

  case 'stop':
    runStop()
    break

  case 'mcp':
    startMcpServer().catch(console.error)
    break

  case 'compress':
    runCompress(process.argv.slice(3)).catch(console.error)
    break

  case 'recall':
    runRecall(process.argv.slice(3)).catch(console.error)
    break

  case 'remember':
    runRemember(process.argv.slice(3)).catch(console.error)
    break

  case 'install':
    runInstall().catch(console.error)
    break

  case 'uninstall':
    runUninstall().catch(console.error)
    break

  case 'status':
    runStatus()
    break

  case 'rebuild-index':
    import('../memory/search-index.js').then(m => m.rebuildIndex())
      .then(() => console.log(JSON.stringify({ success: true })))
      .catch(console.error)
    break

  case 'usage':
    runUsage(process.argv.slice(3)).catch(console.error)
    break

  case 'sessions':
    runSessions(process.argv.slice(3)).catch(console.error)
    break

  case 'refresh':
    runRefresh().catch(console.error)
    break

  case 'inject':
    runInject(process.argv.slice(3)).catch(console.error)
    break

  default:
    console.log(
      'Usage:\n' +
      '  npx doramemory init       — 初始化并配置\n' +
      '  npx doramemory start      — 启动守护进程\n' +
      '  npx doramemory stop       — 停止守护进程\n' +
      '  npx doramemory install    — 安装后台服务 (macOS launchd / 跨平台 pm2)\n' +
      '  npx doramemory uninstall  — 卸载后台服务\n' +
      '  npx doramemory status     — 查看运行状态\n' +
      '  npx doramemory compress   — 压缩存量记忆\n' +
      '  npx doramemory recall     — 搜索/查询记忆\n' +
      '  npx doramemory remember   — 标记/修正记忆\n' +
      '  npx doramemory usage      — 查看 token 用量统计\n' +
      '  npx doramemory sessions    — 查看最新会话摘要\n' +
      '  npx doramemory refresh     — 手动刷新 MEMORY.md\n' +
      '  npx doramemory inject      — 向文件注入记忆并加入监控\n' +
      '  npx doramemory rebuild-index — 重建搜索索引\n' +
      '  npx doramemory mcp        — 启动 MCP server\n'
    )
}
