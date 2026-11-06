import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { assertHandoff } from './handoff.ts'

export interface BoardCard {
  role: string
  kind: 'chat' | 'task'
  summary: string
}

export interface BoardReceipt {
  status: 'accepted' | 'duplicate'
  triggerId: string
  ticketId: string | null
  session: string
  lane: 'chat' | 'task'
  disposition?: 'running' | 'queued' | 'duplicate'
}

export type BoardStatus = 'accepted' | 'duplicate' | 'queued' | 'claim'

/**
 * 一行审计。看板不派活。
 * `queued` 是被打断或还没轮到的工单；`claim` 是派单失败后的招领行。
 * handoffNote 最多 200 字。普通派单留空，打断时写在被放下的那一行上。
 */
export interface AuditRow {
  id: string
  at: string
  input: string
  target: 'main' | 'worker' | 'mixed'
  urgency: 0 | 1 | 2
  cards: BoardCard[]
  via: 'flash' | 'rules'
  reason: string
  handoffNote: string
  status: BoardStatus
  receipts: BoardReceipt[]
}

export class Board {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  append(row: AuditRow): AuditRow {
    const stored: AuditRow = { ...row, handoffNote: assertHandoff(row.handoffNote) }
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(stored)}\n`, 'utf8')
    return stored
  }

  list(): AuditRow[] {
    if (!existsSync(this.file)) return []
    const text = readFileSync(this.file, 'utf8')
    const rows: AuditRow[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      rows.push(JSON.parse(line) as AuditRow)
    }
    return rows
  }

  /** 改一行已有审计，用来给被打断的工单补交接备注。 */
  patch(id: string, fields: Partial<Pick<AuditRow, 'handoffNote' | 'status' | 'receipts'>>): AuditRow {
    const rows = this.list()
    const index = rows.findIndex((row) => row.id === id)
    const current = index >= 0 ? rows[index] : undefined
    if (!current) throw new Error(`找不到审计行 ${id}`)
    const next: AuditRow = {
      ...current,
      ...fields,
      handoffNote: assertHandoff(fields.handoffNote ?? current.handoffNote),
    }
    rows[index] = next
    // 原子写（与 WorkerLane.save 同法）：跨进程并发下读-改-覆盖写不加锁，
    // 至少保证读者永远看到完整文件，不会读到写了一半的行。
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
    renameSync(tmp, this.file)
    return next
  }
}
