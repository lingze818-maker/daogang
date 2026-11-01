import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Board, HANDOFF_MAX, clampHandoff, type AuditRow } from '../src/index.ts'

function row(handoffNote = ''): AuditRow {
  return {
    id: 'audit-1',
    at: '2026-11-01T12:00:00.000Z',
    input: '帮我补上安装说明',
    target: 'worker',
    urgency: 1,
    cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
    via: 'rules',
    reason: '关键词：任务',
    handoffNote,
    status: 'accepted',
    receipts: [
      {
        status: 'accepted',
        triggerId: 'inbox:m1:task',
        ticketId: 'abcd1234',
        session: 'worker-abcd1234',
        lane: 'task',
      },
    ],
  }
}

describe('board', () => {
  it('appends one JSONL audit row and reads it back', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-board-'))
    const board = new Board(join(home, 'nested', 'board.jsonl'))
    board.append(row())
    expect(board.list()).toEqual([row()])
  })

  it('accepts a 200-character handoff and rejects 201', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-board-'))
    const board = new Board(join(home, 'board.jsonl'))
    const note = '备'.repeat(HANDOFF_MAX)
    expect(board.append(row(note)).handoffNote).toBe(note)
    expect(() => board.append(row('备'.repeat(HANDOFF_MAX + 1)))).toThrow(/200/)
    expect(board.list()).toHaveLength(1)
  })

  it('patches a handoff onto an existing row and clamps automatic notes', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-board-'))
    const board = new Board(join(home, 'board.jsonl'))
    board.append(row())
    const note = clampHandoff(`打断：${'字'.repeat(250)}`)
    expect(Array.from(note).length).toBe(HANDOFF_MAX)
    const patched = board.patch('audit-1', { handoffNote: note, status: 'queued' })
    expect(patched).toMatchObject({ id: 'audit-1', status: 'queued', handoffNote: note })
    expect(board.list()[0]).toMatchObject({ status: 'queued', handoffNote: note })
    expect(() => board.patch('missing', { handoffNote: '无' })).toThrow(/找不到审计行/)
  })
})
