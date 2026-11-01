import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { InboxTrigger } from './trigger.ts'

export interface InboxReceipt {
  status: 'accepted' | 'duplicate'
  triggerId: string
  ticketId: string | null
  session: string
  lane: 'chat' | 'task'
  at: string
}

interface InboxFile {
  triggers: Record<string, InboxReceipt>
}

/**
 * `SourceContext.receive` 的本地替身。
 * 任务腿分配 `worker-<ticketId>`；闲聊腿记到 `main`。
 * 同一 Trigger id 再投一次返回 duplicate，不新开票。
 * 这里没有调用底座 Assignment 或 DshExecutor.start。派工在分发器的执行口。
 */
export class LocalInbox {
  readonly file: string
  private readonly ticketId: () => string

  constructor(file: string, ticketId: () => string = () => randomBytes(4).toString('hex')) {
    this.file = file
    this.ticketId = ticketId
  }

  receive(trigger: InboxTrigger): InboxReceipt {
    if (trigger.source !== 'inbox' || !trigger.id) {
      throw new Error('不是 inbox Trigger')
    }
    const store = this.read()
    const existing = store.triggers[trigger.id]
    if (existing) {
      return { ...existing, status: 'duplicate' }
    }
    const at = trigger.at
    let ticketId: string | null = null
    let session = 'main'
    if (trigger.meta.lane === 'task') {
      ticketId = this.ticketId()
      session = `worker-${ticketId}`
    }
    const receipt: InboxReceipt = {
      status: 'accepted',
      triggerId: trigger.id,
      ticketId,
      session,
      lane: trigger.meta.lane,
      at,
    }
    store.triggers[trigger.id] = receipt
    this.write(store)
    return receipt
  }

  private read(): InboxFile {
    if (!existsSync(this.file)) return { triggers: {} }
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as InboxFile
    return { triggers: parsed.triggers ?? {} }
  }

  private write(store: InboxFile): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
  }
}
