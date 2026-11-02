#!/usr/bin/env node
// D3 首响延时（真链路版）：dispatch → 桥 → DSH receive → 评估 accept → worker 开工
// 需 DSH 测试环境在跑（默认 http://127.0.0.1:3082）与 DAOGANG_HOME 对齐。
// 闲聊腿只测 L1/L2（不开工单）；任务腿全链路（会开真工单，任务内容应选有用工件）。
// 产物：bench/results-latency.json（含逐段时间线）
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DSH = process.env.DSH_URL ?? 'http://127.0.0.1:3082'
const HOME = process.env.DAOGANG_HOME
if (!HOME) { console.error('需要 DAOGANG_HOME（与 DSH 服务共享）'); process.exit(2) }

async function overview() {
  const r = await fetch(`${DSH}/orchestrator/api/overview`, { headers: { 'x-orchestrator-request': '1', Host: '127.0.0.1:3082' } })
  return r.json()
}

async function dispatchLine(text) {
  const t0 = Date.now()
  const out = execFileSync('node', [join(here, '..', 'packages', 'dispatcher', 'src', 'cli.ts'), 'dispatch', '--', text], {
    env: process.env, encoding: 'utf8', timeout: 60000,
  })
  const t1 = Date.now()
  return { text, dispatchMs: t1 - t0, output: JSON.parse(out.slice(out.indexOf('{'))) }
}

async function waitAccepted(beforeAccepted, timeoutMs = 300000) {
  const t0 = Date.now()
  for (;;) {
    const ov = await overview()
    if ((ov.flow?.accepted ?? 0) > beforeAccepted) {
      return { acceptedAt: Date.now(), waitedMs: Date.now() - t0, ov }
    }
    if (Date.now() - t0 > timeoutMs) {
      // 终检：评估冷启动（服务重启后首个 tick）可能拖 ~3min，超时不等于没接受
      const final = await overview()
      return { acceptedAt: (final.flow?.accepted ?? 0) > beforeAccepted ? Date.now() : null, waitedMs: Date.now() - t0, ov: final, timedOut: true }
    }
    await new Promise(r => setTimeout(r, 2000))
  }
}

const CHAT = ['你好', '在吗', '今天好安静', '晚安', '早']
const TASKS = [
  '帮我在 docs/notes 里新建一页 2026-11-02 闭环时间线笔记，记录今天从 D1 评测到 worker 开 PR 的关键节点',
  '帮我起草 CHANGELOG：把 11-02 的 D1/D2/D3 评测、混合裁决、跨进程桥、DSH 环境与首个端到端闭环写成草稿存到 docs/CHANGELOG-draft.md',
]

const results = []
for (const text of CHAT) {
  const r = await dispatchLine(text)
  results.push({ kind: 'chat', ...r, notes: r.output.receipts?.map(x => x.status) })
}
const chatDispatch = results.filter(r => r.kind === 'chat').map(r => r.dispatchMs).sort((a, b) => a - b)

for (const text of TASKS) {
  const ov0 = await overview()
  const before = ov0.flow?.accepted ?? 0
  const r = await dispatchLine(text)
  const acc = await waitAccepted(before)
  results.push({ kind: 'task', ...r, acceptWaitMs: acc.waitedMs, accepted: acc.acceptedAt != null })
}

const taskRows = results.filter(r => r.kind === 'task')
const summary = {
  suite: 'D3 首响延时（真链路）',
  at: new Date().toISOString(),
  dsh: DSH,
  chat_n: chatDispatch.length,
  chat_dispatch_p50: chatDispatch[Math.floor(chatDispatch.length / 2)],
  chat_dispatch_max: chatDispatch[chatDispatch.length - 1],
  task_n: taskRows.length,
  task_dispatch_ms: taskRows.map(r => r.dispatchMs),
  task_accept_wait_ms: taskRows.map(r => r.acceptWaitMs),
  note: 'dispatch=CLI 进程内路由+落盘；accept_wait=从 dispatch 返回到 DSH flow.accepted 增量（含桥轮询 1s 粒度+评估）。worker 开工到 PR 的时长见 DSH 工单。',
}
writeFileSync(join(here, 'results-latency.json'), JSON.stringify({ summary, results }, null, 2))
console.log(JSON.stringify(summary, null, 2))
