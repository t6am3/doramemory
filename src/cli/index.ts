#!/usr/bin/env node
import { runInit } from './init.js'
import { startDaemon } from '../daemon/index.js'
import { startMcpServer } from '../mcp/server.js'

const command = process.argv[2]

switch (command) {
  case 'init':
    runInit().catch(console.error)
    break

  case 'start':
    startDaemon().catch(console.error)
    break

  case 'mcp':
    startMcpServer().catch(console.error)
    break

  case 'status':
    console.log('TODO: status')
    break

  default:
    console.log(
      'Usage:\n' +
      '  npx doramemory init     — 初始化并配置\n' +
      '  npx doramemory start    — 启动守护进程\n' +
      '  npx doramemory mcp      — 启动 MCP server\n' +
      '  npx doramemory status   — 查看运行状态\n'
    )
}
