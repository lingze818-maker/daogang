#!/usr/bin/env node
// 到岗 → zcode 看板派单入口（E4 狗粮线）：
//   node --experimental-strip-types scripts/dispatch-to-board.mjs "一句话任务"
// 路由走关键词兜底（不烧模型）；任务腿经 ZcodeHost 投到 agent-board，
// 由 zcode 侧窗口/班次认领执行。闲聊腿打印不投板。
// 环境：DAOGANG_BOARD_SCRIPT（board.py 路径，默认主工作区）、DAOGANG_BOARD_ROOT（默认主工作区）。
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = p => pathToFileURL(join(here, '..', 'packages', p)).href

const { routeByRules } = await import(pkg('dispatcher/src/rules.ts'))
const { ZcodeHost } = await import(pkg('host-adapter/src/zcode-host.ts'))

const text = process.argv[2]
if (!text) {
  console.error('用法：node --experimental-strip-types scripts/dispatch-to-board.mjs "一句话任务"')
  process.exit(2)
}

const DEFAULT_SCRIPT = 'D:/Users/那刻夏zcode/zcode-agent-board/agent-board/skills/agent-board/scripts/board.py'
const DEFAULT_ROOT = 'D:/Users/那刻夏zcode'
const host = new ZcodeHost({
  script: process.env.DAOGANG_BOARD_SCRIPT ?? DEFAULT_SCRIPT,
  root: process.env.DAOGANG_BOARD_ROOT ?? DEFAULT_ROOT,
  python: process.platform === 'win32' ? 'python' : 'python3',
})

const { decision } = routeByRules(text)
if (decision.target === 'main') {
  console.log(JSON.stringify({ target: 'main', note: '闲聊腿不投板', summary: decision.cards[0]?.summary }))
  process.exit(0)
}

const taskCard = decision.cards.find(card => card.kind === 'task')
if (!taskCard) {
  console.log(JSON.stringify({ target: decision.target, note: '无任务卡', urgency: decision.urgency }))
  process.exit(0)
}

const ticketId = `bd${Date.now().toString(36)}`
const session = await host.openSession({ kind: 'worker', ticketId, summary: taskCard.summary })
console.log(JSON.stringify({
  target: 'worker',
  urgency: decision.urgency,
  ticketId,
  session: session.id,
  board: process.env.DAOGANG_BOARD_ROOT ?? DEFAULT_ROOT,
  summary: taskCard.summary,
  note: '已投 agent-board，等 zcode 窗口/班次认领（board claim）',
}))
