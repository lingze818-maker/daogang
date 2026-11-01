import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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
}

/**
 * 一行审计。看板不派活，只留「谁、何时、为何」以及可选的交接备注。
 * 打断/抢占尚未实现；handoffNote 先占位，派单时为空字符串。
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
  status: 'accepted' | 'duplicate' | 'error'
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
}
