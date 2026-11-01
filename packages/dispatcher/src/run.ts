import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Board, type AuditRow } from '@daogang/board'
import { LocalInbox, inboxTrigger, type Decision, type InboxReceipt } from '@daogang/inbox-source'
import { createFlashRouter } from './flash.ts'
import { routeText, type FlashRouter } from './route.ts'
import { charLength, INPUT_MAX } from './text.ts'

export class DaogangError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaogangError'
  }
}

export interface DispatchOutput {
  target: Decision['target']
  urgency: Decision['urgency']
  cards: Decision['cards']
  via: 'flash' | 'rules'
  reason: string
  /** 接单发生在本地 inbox，不是 DSH worker Session。 */
  runtime: 'local-inbox'
  audit: { id: string; file: string }
  receipts: InboxReceipt[]
}

export interface Runtime {
  board: Board
  inbox: LocalInbox
  flash: FlashRouter
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
    flash: createFlashRouter(env),
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

/**
 * 一句话进，一条判定出，并追加一行审计。
 * mixed 会连续投两张 Trigger：闲聊进 main，任务进 worker-<ticketId>。两边都是本地调用，没有互相等待底座。
 */
export async function dispatchLine(
  raw: string,
  runtime: Runtime,
  options: { now?: Date; messageId?: string } = {},
): Promise<DispatchOutput> {
  const text = raw.trim()
  if (!text) throw new DaogangError('请输入一句话')
  if (charLength(text) > INPUT_MAX) {
    throw new DaogangError(`输入超过 ${INPUT_MAX} 字`)
  }
  const now = options.now ?? new Date()
  const routed = await routeText(text, runtime.flash)
  const messageId = messageIdFor(text, now, options.messageId)
  const receipts: InboxReceipt[] = []
  for (const lane of lanesOf(routed.decision.target)) {
    const trigger = inboxTrigger({
      messageId,
      at: now.toISOString(),
      text,
      decision: routed.decision,
      lane,
    })
    receipts.push(runtime.inbox.receive(trigger))
  }
  const duplicate = receipts.every((item) => item.status === 'duplicate')
  const row: AuditRow = {
    id: randomUUID(),
    at: now.toISOString(),
    input: text,
    target: routed.decision.target,
    urgency: routed.decision.urgency,
    cards: routed.decision.cards,
    via: routed.via,
    reason: routed.reason,
    handoffNote: '',
    status: duplicate ? 'duplicate' : 'accepted',
    receipts,
  }
  runtime.board.append(row)
  return {
    target: routed.decision.target,
    urgency: routed.decision.urgency,
    cards: routed.decision.cards,
    via: routed.via,
    reason: routed.reason,
    runtime: 'local-inbox',
    audit: { id: row.id, file: runtime.board.file },
    receipts,
  }
}
