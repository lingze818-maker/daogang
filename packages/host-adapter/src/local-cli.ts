import { join } from 'node:path'
import { Board } from '@daogang/board'
import {
  assignTask,
  INPUT_MAX,
  LocalExecutor,
  replyOnMain,
  WorkerLane,
  workerSessionId,
  type WorkerSlot,
} from '@daogang/dispatcher'
import {
  HostAdapterError,
  type HostAdapter,
  type HostAuth,
  type HostContext,
  type HostMessage,
  type HostSession,
  type InterruptInput,
  type InterruptResult,
  type OpenSessionInput,
  type SendMessageInput,
} from './adapter.ts'

/**
 * 把当前外围 CLI 的五件事收成 HostAdapter。
 * 执行口固定是 LocalExecutor，不读 DAOGANG_EXECUTOR / DAOGANG_DSH_ROOT。
 * 不开 DSH 会话。`pnpm dispatch` 仍走原来的 CLI，不经过这个类。
 */
export class LocalCliHost implements HostAdapter {
  readonly id = 'local-cli' as const
  readonly home: string

  constructor(home: string) {
    if (!home.trim()) throw new HostAdapterError('LocalCliHost 需要一个目录')
    this.home = home
  }

  async sendMessage(input: SendMessageInput): Promise<HostMessage> {
    const text = requireText(input.text)
    const at = input.at ?? new Date().toISOString()
    if (input.sessionId === 'main') {
      const reply = replyOnMain({ summary: text, at })
      return { sessionId: reply.session, text: reply.text, at: reply.at }
    }
    const ticketId = ticketFromSession(input.sessionId)
    await this.executor().deliver({ ticketId, session: input.sessionId, text })
    return { sessionId: input.sessionId, text, at }
  }

  async openSession(input: OpenSessionInput): Promise<HostSession> {
    if (input.kind === 'main') return { id: 'main', kind: 'main' }
    const ticketId = requireTicket(input.ticketId)
    return { id: workerSessionId(ticketId), kind: 'worker' }
  }

  /**
   * 与分发器 placeTask 相同：只有 incoming 更急才放下 sessionId。
   * 交接备注用 handoffFor，看板把那一行改成 queued。
   */
  async interrupt(input: InterruptInput): Promise<InterruptResult> {
    const ticketId = requireTicket(input.incoming.ticketId)
    const summary = requireText(input.incoming.summary)
    const workers = new WorkerLane(join(this.home, 'worker.json'))
    const state = workers.load()
    if (!state.busy || state.busy.session !== input.sessionId) {
      throw new HostAdapterError('当前没有这个会话可打断')
    }
    const incoming: WorkerSlot = {
      ticketId,
      session: workerSessionId(ticketId),
      auditId: input.incoming.auditId,
      urgency: input.incoming.urgency,
      summary,
    }
    const planned = assignTask(state, incoming)
    if (!planned.paused) {
      throw new HostAdapterError('本地 CLI 只有更高优先级才会放下当前工单')
    }
    await this.executor().start({
      ticketId,
      session: incoming.session,
      assignmentId: input.incoming.auditId,
      urgency: input.incoming.urgency,
      cards: [{ role: 'worker', kind: 'task', summary }],
      text: summary,
      handoffNote: '',
    })
    const board = new Board(join(this.home, 'board.jsonl'))
    const pausedRow = board.list().find((row) => row.id === planned.paused?.auditId)
    board.patch(planned.paused.auditId, {
      handoffNote: planned.handoffNote,
      status: 'queued',
      receipts: (pausedRow?.receipts ?? []).map((item) => (
        item.lane === 'task' ? { ...item, disposition: 'queued' as const } : item
      )),
    })
    workers.save(planned.state)
    return {
      pausedSessionId: planned.paused.session,
      handoffNote: planned.handoffNote,
      nowSessionId: incoming.session,
    }
  }

  async readContext(sessionId: string): Promise<HostContext> {
    const board = new Board(join(this.home, 'board.jsonl'))
    const rows = board.list().filter((row) => (
      row.receipts.some((item) => item.session === sessionId)
      || (sessionId === 'main' && row.cards.some((card) => card.kind === 'chat'))
    ))
    const latest = rows.at(-1)
    const workers = new WorkerLane(join(this.home, 'worker.json'))
    const state = workers.load()
    const slot = [state.busy, ...state.queue].find((item) => item?.session === sessionId) ?? null
    if (sessionId !== 'main' && !slot && !latest) {
      throw new HostAdapterError(`本地没有会话 ${sessionId}`)
    }
    const chat = latest?.cards.find((card) => card.kind === 'chat')?.summary
    return {
      sessionId,
      text: slot?.summary || chat || latest?.input || '',
      handoffNote: latest?.handoffNote ?? '',
    }
  }

  async auth(): Promise<HostAuth> {
    return { state: 'anonymous', detail: '本地 CLI 没有账号，也不读取密钥' }
  }

  private executor(): LocalExecutor {
    return new LocalExecutor(join(this.home, 'executor.json'))
  }
}

function requireText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new HostAdapterError('请输入一句话')
  if (Array.from(trimmed).length > INPUT_MAX) {
    throw new HostAdapterError(`输入超过 ${INPUT_MAX} 字`)
  }
  return trimmed
}

function requireTicket(ticketId: string | undefined): string {
  const id = ticketId?.trim() ?? ''
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new HostAdapterError('ticketId 无效')
  }
  return id
}

function ticketFromSession(sessionId: string): string {
  const prefix = 'worker-'
  if (!sessionId.startsWith(prefix)) throw new HostAdapterError(`不是本地会话 ${sessionId}`)
  return requireTicket(sessionId.slice(prefix.length))
}
