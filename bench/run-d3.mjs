#!/usr/bin/env node
// D3 打断恢复正确率（外围路径，无密钥无网络）：
// ① assignTask 纯函数固定用例集（打断/不打断/队列顺序/信息完整性/交接备注边界）
// ② WorkerLane 落盘→重读 roundtrip（"走神能回来"的前提）
// ③ dispatchLine 端到端：普通→急 mixed→不急 三连，看板行为与交接备注
// 产出：bench/results-d3.json（用例数/通过率/失败原文）
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = p => pathToFileURL(join(here, '..', 'packages', 'dispatcher', 'src', p)).href
const { assignTask, WorkerLane, emptyWorkerState } = await import(pkg('worker.ts'))
const { dispatchLine, openRuntime, resolveHome } = await import(pkg('run.ts'))

const cases = []
const add = (id, desc, fn) => cases.push({ id, desc, fn })

const slot = (ticketId, urgency, summary = `工单 ${ticketId}`) => ({
  ticketId, session: `worker-${ticketId}`, auditId: `audit-${ticketId}`, urgency, summary,
})

// —— ① assignTask 纯函数用例 ——
add('u01-idle-runs', '空闲收单：直接 running，队列为空', () => {
  const a = assignTask(emptyWorkerState(), slot('t1', 1))
  assert(a.disposition === 'running', `期望 running，得到 ${a.disposition}`)
  assert(a.paused === null, '空闲收单不应有 paused')
  assert(a.state.queue.length === 0, '空闲收单队列应为空')
  assert(a.handoffNote === '', '空闲收单不应有交接备注')
})

add('u02-same-urgency-queues', '同级不打断：新单排队，当前不动', () => {
  const busy = slot('t1', 1)
  const a = assignTask({ busy, queue: [] }, slot('t2', 1))
  assert(a.disposition === 'queued', `期望 queued，得到 ${a.disposition}`)
  assert(a.paused === null, '同级不应产生 paused')
  assert(a.state.busy.ticketId === 't1', '当前工单被错误挤掉')
  assert(a.handoffNote === '', '未打断不应有交接备注')
})

add('u03-lower-urgency-queues', '低优不打断高优：只排队', () => {
  const a = assignTask({ busy: slot('t1', 2), queue: [] }, slot('t2', 1))
  assert(a.disposition === 'queued' && a.paused === null, `低不打高，却得到 ${a.disposition}/paused=${a.paused}`)
  assert(a.state.busy.ticketId === 't1', '高优被低优挤掉')
})

add('u04-higher-interrupts', '高优打断低优：新单上、旧单入队、备注≤200', () => {
  const busy = slot('t1', 1, '写部署文档')
  const a = assignTask({ busy, queue: [] }, slot('t2', 2))
  assert(a.disposition === 'running', '打断后新单应 running')
  assert(a.paused?.ticketId === 't1', `paused 应为 t1，得到 ${a.paused?.ticketId}`)
  assert(a.state.busy.ticketId === 't2', '新单未接管')
  assert(a.state.queue.some(s => s.ticketId === 't1'), '被打断工单没进队列')
  assert(a.handoffNote.includes('打断') && a.handoffNote.includes('写部署文档'), `备注缺关键信息：${a.handoffNote}`)
  assert(a.handoffNote.length <= 200, `备注 ${a.handoffNote.length} 字超限`)
})

add('u05-fifo-after-interrupt', '打断后继续排队保持 FIFO 顺序', () => {
  const paused = slot('t1', 1)
  const after = { busy: slot('t2', 2), queue: [paused] }
  const a = assignTask(after, slot('t3', 1))
  assert(a.disposition === 'queued', `期望 queued，得到 ${a.disposition}`)
  const ids = a.state.queue.map(s => s.ticketId)
  assert(JSON.stringify(ids) === JSON.stringify(['t1', 't3']), `队列顺序错：${ids}`)
})

add('u06-post-interrupt-lower-queues', '打断发生后再来低优：不打断，排队', () => {
  const a = assignTask({ busy: slot('t2', 2), queue: [slot('t1', 1)] }, slot('t3', 1))
  assert(a.disposition === 'queued' && a.paused === null, '打断后低优不应再打断')
})

add('u07-multi-queue-interrupt', '队列已有两张时打断：paused 排到队尾', () => {
  const a = assignTask({ busy: slot('t0', 1), queue: [slot('t1', 1), slot('t2', 1)] }, slot('t9', 2))
  const ids = a.state.queue.map(s => s.ticketId)
  assert(JSON.stringify(ids) === JSON.stringify(['t1', 't2', 't0']), `paused 应排队尾，得到 ${ids}`)
})

add('u08-idle-zero-urgency-runs', '空闲时再闲的单也直接干（不排队）', () => {
  const a = assignTask(emptyWorkerState(), slot('t1', 0))
  assert(a.disposition === 'running', `空闲+u0 应 running，得到 ${a.disposition}`)
})

add('u09-handoff-clamp-200', '超长摘要被打断：交接备注仍≤200', () => {
  const long = slot('t1', 1, '长'.repeat(400))
  const a = assignTask({ busy: long, queue: [] }, slot('t2', 2))
  assert(a.handoffNote.length <= 200 && a.handoffNote.length > 0, `备注 ${a.handoffNote.length} 字`)
})

add('u10-paused-info-integrity', '被打断工单五字段逐项无损（恢复的前提）', () => {
  const busy = slot('t1', 1, '排查登录超时')
  const a = assignTask({ busy, queue: [] }, slot('t2', 2))
  const inQueue = a.state.queue.find(s => s.ticketId === 't1')
  for (const k of ['ticketId', 'session', 'auditId', 'urgency', 'summary']) {
    assert(inQueue[k] === busy[k], `字段 ${k} 打断后改变：${JSON.stringify(busy[k])} → ${JSON.stringify(inQueue[k])}`)
  }
})

// —— ② 落盘恢复 roundtrip ——
add('r01-lane-roundtrip', '打断后状态落盘→重读，状态全等（走神能回来）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'd3-lane-'))
  try {
    const lane = new WorkerLane(join(dir, 'executor.json'))
    const a = assignTask({ busy: slot('t1', 1, '修分页 bug'), queue: [] }, slot('t2', 2))
    lane.save(a.state)
    const restored = lane.load()
    assert(JSON.stringify(restored) === JSON.stringify(a.state), '落盘重读后状态不一致')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

// —— ③ dispatchLine 端到端（急 mixed 打断普通单）——
add('e01-e2e-interrupt', '端到端三连：普通→急 mixed（打断）→不急，看板与备注正确', async () => {
  const home = mkdtempSync(join(tmpdir(), 'd3-home-'))
  try {
    const env = { ...process.env, DAOGANG_HOME: home, DAOGANG_FAIL_LANE: '' }
    delete env.DAOGANG_DSH_ROOT
    const runtime = openRuntime(resolveHome(undefined, env), env)
    await dispatchLine('帮我写一份接口文档', runtime)
    const second = await dispatchLine('谢谢，马上帮我修一下登录 bug', runtime)
    await dispatchLine('不急，帮我补个示例', runtime)
    assert(second.interrupt !== null, '急 mixed 未产生打断信息')
    assert(second.interrupt.paused.handoffNote.length <= 200, `端到端备注 ${second.interrupt.paused.handoffNote.length} 字超限`)
    const board = readFileSync(join(home, 'board.jsonl'), 'utf8').trim().split(/\r?\n/).map(l => JSON.parse(l))
    assert(board.length === 3, `看板应有 3 行，得到 ${board.length}`)
    assert(board[2].status === 'queued', `第 3 行（不急）应排队，得到 ${board[2].status}`)
    const first = board.find(r => (r.input || '').includes('接口文档'))
    assert(first.status === 'queued', `被打断的第 1 行应翻成 queued，得到 ${first.status}`)
    assert(first.handoffNote.includes('打断'), `被打断行的看板备注缺「打断」：${first.handoffNote}`)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

function assert(cond, msg) { if (!cond) throw new Error(msg) }

// —— 跑 ——
const results = []
let passed = 0
for (const c of cases) {
  try {
    await c.fn()
    passed++
    results.push({ id: c.id, desc: c.desc, pass: true })
  } catch (e) {
    results.push({ id: c.id, desc: c.desc, pass: false, failure: String(e.message || e) })
  }
}
const summary = {
  suite: 'D3 打断恢复正确率（外围路径）',
  at: new Date().toISOString(),
  total: cases.length,
  passed,
  pass_rate: +(passed / cases.length).toFixed(3),
  failures: results.filter(r => !r.pass),
}
writeFileSync(join(here, 'results-d3.json'), JSON.stringify({ ...summary, cases: results }, null, 2))
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.failures.length ? 1 : 0)
