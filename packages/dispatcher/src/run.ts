import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Board, type AuditRow, type BoardStatus } from '@daogang/board'
import {
  LocalInbox,
  appendTrigger,
  inboxTrigger,
  type Decision,
  type InboxReceipt,
} from '@daogang/inbox-source'
import { createExecutor, type ExecutorPort } from './executor.ts'
import { createFlashRouter } from './flash.ts'
import { replyOnMain, type MainReply } from './main-channel.ts'
import { routeText, type FlashRouter } from './route.ts'
import { charLength, clampText, INPUT_MAX } from './text.ts'
import { assignTask, WorkerLane, type WorkerSlot } from './worker.ts'

export class DaogangError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaogangError'
  }
}

export interface DispatchReceipt extends InboxReceipt {
  disposition: 'running' | 'queued' | 'duplicate'
}

export interface InterruptInfo {
  paused: { session: string; auditId: string; handoffNote: string }
  now: { session: string; auditId: string }
}

export interface ClaimInfo {
  id: string
  lane: 'chat' | 'task' | 'dispatch'
  reason: string
}

export interface DispatchOutput {
  target: Decision['target']
  urgency: Decision['urgency']
  cards: Decision['cards']
  via: 'flash' | 'rules'
  reason: string
  /** 接单发生在本地 inbox，不是 DSH worker Session。 */
  runtime: 'local-inbox'
  /** `local` 是默认执行口。`dsh` 是适配器：没根目录时落招领；有根目录时只表示 enqueue 被调用过。 */
  executor: 'local' | 'dsh'
  audit: { id: string; file: string }
  receipts: DispatchReceipt[]
  /** 闲聊腿的主窗桩回复。任务腿失败或还在排队时它也已经留下。 */
  mainReply: MainReply | null
  interrupt: InterruptInfo | null
  claims: ClaimInfo[]
}

export interface Runtime {
  board: Board
  inbox: LocalInbox
  /** 跨进程桥（issue #24）：接单成功的 trigger 追加到这份 jsonl，DSH 侧 inbox source tail 它。 */
  triggerLog: string
  flash: FlashRouter
  workers: WorkerLane
  executor: ExecutorPort
}

export interface DispatchOptions {
  now?: Date
  messageId?: string
  /** 演示用：这一腿在 receive 前失败，审计落成招领行。 */
  failLane?: 'chat' | 'task'
  /** 测试用。主窗回复已经同步留下之后才会 await。 */
  beforeTask?: () => Promise<void>
  onMain?: () => void
}

export function resolveHome(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit) return explicit
  if (env.DAOGANG_HOME) return env.DAOGANG_HOME
  return join(process.cwd(), '.daogang')
}

export function openRuntime(home: string, env: NodeJS.ProcessEnv = process.env): Runtime {
  return {
    board: new Board(join(home, 'board.jsonl')),
    inbox: new LocalInbox(join(home, 'inbox.json')),
    triggerLog: join(home, 'triggers.jsonl'),
    flash: createFlashRouter(env),
    workers: new WorkerLane(join(home, 'worker.json')),
    executor: createExecutor(home, env),
  }
}

function messageIdFor(text: string, now: Date, explicit?: string): string {
  if (explicit) return explicit
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 8)
  return `${now.getTime().toString(36)}-${digest}`
}

function lanesOf(target: Decision['target']): Array<'chat' | 'task'> {
  if (target === 'main') return ['chat']
  if (target === 'worker') return ['task']
  return ['chat', 'task']
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '分发失败'
  const oneLine = message.replace(/\s+/g, ' ').trim() || '分发失败'
  return clampText(oneLine, 120)
}

interface LaneSuccess {
  lane: 'chat' | 'task'
  reply: MainReply | null
  receipt: InboxReceipt
}

interface LaneFailure {
  lane: 'chat' | 'task'
  reply: MainReply | null
  error: string
}

type LaneResult = LaneSuccess | LaneFailure

function isFailure(result: LaneResult): result is LaneFailure {
  return 'error' in result
}

/**
 * 一句话进，一条判定出，并追加审计。
 * 闲聊腿先写主窗桩回复，任务腿另走，互不等待。
 * 更高优先级会把正在忙的工单改成 queued，并在那一行写下交接备注。
 * receive 失败时追加招领行，不把异常吞掉。
 */
export async function dispatchLine(
  raw: string,
  runtime: Runtime,
  options: DispatchOptions = {},
): Promise<DispatchOutput> {
  const text = raw.trim()
  if (!text) throw new DaogangError('请输入一句话')
  if (charLength(text) > INPUT_MAX) {
    throw new DaogangError(`输入超过 ${INPUT_MAX} 字`)
  }
  const now = options.now ?? new Date()
  const at = now.toISOString()
  let routed: Awaited<ReturnType<typeof routeText>>
  try {
    routed = await routeText(text, runtime.flash)
  } catch (error) {
    return finishClaims(runtime, text, at, fallbackDecision(), 'rules', [claimFor('dispatch', safeError(error))])
  }

  const messageId = messageIdFor(text, now, options.messageId)
  const lanes = lanesOf(routed.decision.target)
  const jobs: Array<Promise<LaneResult>> = []
  if (lanes.includes('chat')) jobs.push(runChat(runtime, routed.decision, text, at, messageId, options))
  if (lanes.includes('task')) jobs.push(runTask(runtime, routed.decision, text, at, messageId, options))
  const results = await Promise.all(jobs)

  const auditId = randomUUID()
  const receipts: DispatchReceipt[] = []
  const claims: ClaimInfo[] = []
  let mainReply: MainReply | null = null
  let interrupt: InterruptInfo | null = null

  for (const result of results) {
    if (result.reply) mainReply = result.reply
    if (isFailure(result)) {
      claims.push(claimFor(result.lane, result.error))
      continue
    }
    if (result.lane === 'chat' || result.receipt.status === 'duplicate') {
      receipts.push({
        ...result.receipt,
        disposition: result.receipt.status === 'duplicate' ? 'duplicate' : 'running',
      })
      continue
    }
    try {
      const placed = await placeTask(runtime, routed.decision, result.receipt, auditId)
      if (placed.interrupt) interrupt = placed.interrupt
      receipts.push({ ...result.receipt, disposition: placed.disposition })
    } catch (error) {
      claims.push(claimFor('task', safeError(error)))
    }
  }

  const primary = receipts.length > 0
    ? appendRow(runtime, {
      id: auditId,
      at,
      input: text,
      target: routed.decision.target,
      urgency: routed.decision.urgency,
      cards: routed.decision.cards,
      via: routed.via,
      reason: routed.reason,
      handoffNote: '',
      status: primaryStatus(receipts),
      receipts,
    })
    : null

  const storedClaims = claims.map((claim) => {
    const row = appendRow(runtime, {
      id: claim.id,
      at,
      input: text,
      target: routed.decision.target,
      urgency: routed.decision.urgency,
      cards: routed.decision.cards,
      via: routed.via,
      reason: claim.reason,
      handoffNote: '',
      status: 'claim',
      receipts: [],
    })
    return { ...claim, id: row.id }
  })

  const audit = primary ?? storedClaims[0]
  if (!audit) throw new DaogangError('没有写下审计行')
  return {
    target: routed.decision.target,
    urgency: routed.decision.urgency,
    cards: routed.decision.cards,
    via: routed.via,
    reason: routed.reason,
    runtime: 'local-inbox',
    executor: runtime.executor.kind,
    audit: { id: audit.id, file: runtime.board.file },
    receipts,
    mainReply,
    interrupt,
    claims: storedClaims,
  }
}

function fallbackDecision(): Decision {
  return { target: 'worker', urgency: 1, cards: [] }
}

function claimFor(lane: 'chat' | 'task' | 'dispatch', error: string): ClaimInfo {
  const who = lane === 'chat' ? '主窗腿' : lane === 'task' ? '任务腿' : '分发'
  return { id: randomUUID(), lane, reason: `招领：${who}失败，${error}` }
}

function finishClaims(
  runtime: Runtime,
  text: string,
  at: string,
  decision: Decision,
  via: 'flash' | 'rules',
  claims: ClaimInfo[],
): DispatchOutput {
  const stored = claims.map((claim) => {
    const row = appendRow(runtime, {
      id: claim.id,
      at,
      input: text,
      target: decision.target,
      urgency: decision.urgency,
      cards: decision.cards,
      via,
      reason: claim.reason,
      handoffNote: '',
      status: 'claim',
      receipts: [],
    })
    return { ...claim, id: row.id }
  })
  const first = stored[0]
  if (!first) throw new DaogangError('没有写下招领行')
  return {
    target: decision.target,
    urgency: decision.urgency,
    cards: decision.cards,
    via,
    reason: first.reason,
    runtime: 'local-inbox',
    executor: runtime.executor.kind,
    audit: { id: first.id, file: runtime.board.file },
    receipts: [],
    mainReply: null,
    interrupt: null,
    claims: stored,
  }
}

async function runChat(
  runtime: Runtime,
  decision: Decision,
  text: string,
  at: string,
  messageId: string,
  options: DispatchOptions,
): Promise<LaneResult> {
  const summary = decision.cards.find((card) => card.kind === 'chat')?.summary ?? text
  const reply = replyOnMain({ summary, at })
  options.onMain?.()
  try {
    if (options.failLane === 'chat') throw new Error('目标离线或超时')
    const trigger = inboxTrigger({
      actorId: 'cli', // 与 DSH inbox Policy 名单的 cli 行对齐（explicit sender）
      messageId,
      at,
      text,
      decision,
      lane: 'chat',
    })
    const receipt = runtime.inbox.receive(trigger)
    if (receipt.status === 'accepted') appendTrigger(runtime.triggerLog, trigger)
    return { lane: 'chat', reply, receipt }
  } catch (error) {
    return { lane: 'chat', reply, error: safeError(error) }
  }
}

async function runTask(
  runtime: Runtime,
  decision: Decision,
  text: string,
  at: string,
  messageId: string,
  options: DispatchOptions,
): Promise<LaneResult> {
  try {
    if (options.beforeTask) await options.beforeTask()
    if (options.failLane === 'task') throw new Error('目标离线或超时')
    const trigger = inboxTrigger({
      actorId: 'cli', // 与 DSH inbox Policy 名单的 cli 行对齐（explicit sender）
      messageId,
      at,
      text,
      decision,
      lane: 'task',
    })
    const receipt = runtime.inbox.receive(trigger)
    if (receipt.status === 'accepted') appendTrigger(runtime.triggerLog, trigger)
    return { lane: 'task', reply: null, receipt }
  } catch (error) {
    return { lane: 'task', reply: null, error: safeError(error) }
  }
}

async function placeTask(
  runtime: Runtime,
  decision: Decision,
  receipt: InboxReceipt,
  auditId: string,
): Promise<{ disposition: 'running' | 'queued'; interrupt: InterruptInfo | null }> {
  const summary = decision.cards.find((card) => card.kind === 'task')?.summary ?? ''
  const ticketId = receipt.ticketId ?? ''
  if (!ticketId) throw new Error('任务腿没有 ticket id')
  const incoming: WorkerSlot = {
    ticketId,
    session: receipt.session,
    auditId,
    urgency: decision.urgency,
    summary,
  }
  const planned = assignTask(runtime.workers.load(), incoming)
  if (planned.disposition === 'running') {
    const cards = decision.cards.filter((card) => card.kind === 'task')
    await runtime.executor.start({
      ticketId,
      session: receipt.session,
      assignmentId: auditId,
      urgency: decision.urgency,
      cards,
      text: cards.map((card) => card.summary).join('\n') || summary,
      handoffNote: '',
    })
  }
  if (planned.paused) {
    const paused = runtime.board.list().find((row) => row.id === planned.paused?.auditId)
    runtime.board.patch(planned.paused.auditId, {
      handoffNote: planned.handoffNote,
      status: 'queued',
      receipts: (paused?.receipts ?? []).map((item) => (
        item.lane === 'task' ? { ...item, disposition: 'queued' as const } : item
      )),
    })
  }
  runtime.workers.save(planned.state)
  return {
    disposition: planned.disposition,
    interrupt: planned.paused
      ? {
        paused: {
          session: planned.paused.session,
          auditId: planned.paused.auditId,
          handoffNote: planned.handoffNote,
        },
        now: { session: incoming.session, auditId },
      }
      : null,
  }
}

function primaryStatus(receipts: DispatchReceipt[]): BoardStatus {
  if (receipts.every((item) => item.status === 'duplicate')) return 'duplicate'
  const task = receipts.find((item) => item.lane === 'task')
  const chat = receipts.find((item) => item.lane === 'chat')
  if (task && !chat && task.disposition === 'queued') return 'queued'
  return 'accepted'
}

function appendRow(runtime: Runtime, row: AuditRow): AuditRow {
  try {
    return runtime.board.append(row)
  } catch (error) {
    if (row.status === 'claim') throw error
    return runtime.board.append({
      ...row,
      id: randomUUID(),
      status: 'claim',
      receipts: [],
      handoffNote: '',
      reason: `招领：审计写入失败，${safeError(error)}`,
    })
  }
}
