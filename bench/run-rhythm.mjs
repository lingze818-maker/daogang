#!/usr/bin/env node
// D3 节奏分布（拟人五维最后一维）：响应节奏不是恒定即时——
// 急单（urgency 2）即时处理、普通（1）顺序、缓单（0）排队可等。
// 数据源：DAOGANG_HOME/board.jsonl 的真实派单审计。产物 results-rhythm.json。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const HOME = process.env.DAOGANG_HOME
if (!HOME) { console.error('需要 DAOGANG_HOME'); process.exit(2) }
const boardFile = join(HOME, 'board.jsonl')
if (!existsSync(boardFile)) { console.error(`没有审计板：${boardFile}`); process.exit(2) }

const rows = readFileSync(boardFile, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))

const byUrgency = {}
for (const r of rows) {
  const u = r.urgency ?? 1
  const g = byUrgency[u] ??= { n: 0, running: 0, queued: 0, claim: 0, interrupts: 0, mixed: 0 }
  g.n++
  if (r.status === 'running' || (r.receipts ?? []).some(x => x.disposition === 'running')) g.running++
  if (r.status === 'queued' || (r.receipts ?? []).some(x => x.disposition === 'queued')) g.queued++
  if (r.status === 'claim') g.claim++
  if (r.handoffNote?.includes('打断')) g.interrupts++
  if (r.target === 'mixed') g.mixed++
}

// 节奏判据：三档 urgency 的即时处理率应有单调差（急 > 普通 > 缓）
const rate = u => { const g = byUrgency[u]; return g && g.n ? g.running / g.n : null }
const u2 = rate(2), u1 = rate(1), u0 = rate(0)
const monotonic = u2 != null && u1 != null && u0 != null && u2 >= u1 && u1 >= u0

const summary = {
  suite: 'D3 节奏分布（拟人五维·第 5 维）',
  at: new Date().toISOString(),
  rows: rows.length,
  by_urgency: Object.fromEntries(Object.entries(byUrgency).map(([u, g]) => [u, {
    n: g.n, 即时处理: g.running, 排队: g.queued, 招领: g.claim, 被打断: g.interrupts, mixed双投: g.mixed,
    即时率: +(g.running / g.n).toFixed(2),
  }])),
  即时率单调性_急大于普通大于缓: monotonic,
  note: '节奏拟人的机制证明：urgency 三档经 assignTask 分流（急打断/普通顺序/缓排队），审计板即时率应随 urgency 单调。样本来自真实派单（含 DSH 闭环期）。',
}
writeFileSync(join(here, 'results-rhythm.json'), JSON.stringify({ summary, rows: rows.map(r => ({ at: r.at, urgency: r.urgency, status: r.status, interrupt: !!r.handoffNote?.includes?.('打断') })) }, null, 2))
console.log(JSON.stringify(summary, null, 2))
