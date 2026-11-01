import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply, inboxKind, inboxScope, inboxTrigger, LocalInbox, type Decision } from '../src/index.ts'

const decision: Decision = {
  target: 'worker',
  urgency: 1,
  cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
}

function trigger(lane: 'chat' | 'task' = 'task') {
  const full: Decision = lane === 'chat'
    ? { target: 'main', urgency: 1, cards: [{ role: 'main', kind: 'chat', summary: '你好' }] }
    : decision
  return inboxTrigger({
    messageId: 'm1',
    at: '2026-11-01T12:00:00.000Z',
    text: lane === 'chat' ? '你好' : '帮我补上安装说明',
    decision: full,
    lane,
  })
}

describe('inbox source', () => {
  it('builds a stable explicit trigger', () => {
    const built = trigger()
    expect(built.id).toBe('inbox:m1:task')
    expect(built.source).toBe('inbox')
    expect(built.addressed).toBe('direct')
    expect(built.human).toBe(true)
    expect(built.meta.policy).toBe('explicit')
    expect(built.threads[0]).toEqual({ source: 'inbox', id: 'cli:m1' })
    expect(inboxScope(built.meta, { conversation: 'cli' })).toEqual({
      listened: true,
      observed: false,
      row: 'cli',
    })
    expect(inboxScope({ conversation: 'other' }, { conversation: 'cli' }).reason).toBe('conversation_not_listed')
  })

  it('accepts a task into worker-<ticketId> and a replay as duplicate', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-inbox-'))
    const inbox = new LocalInbox(join(home, 'inbox.json'), () => 'abcd1234')
    const first = inbox.receive(trigger())
    expect(first).toMatchObject({
      status: 'accepted',
      ticketId: 'abcd1234',
      session: 'worker-abcd1234',
      lane: 'task',
    })
    const again = inbox.receive(trigger())
    expect(again.status).toBe('duplicate')
    expect(again.session).toBe('worker-abcd1234')
  })

  it('accepts chat on main without a ticket', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-inbox-'))
    const inbox = new LocalInbox(join(home, 'inbox.json'))
    const receipt = inbox.receive(trigger('chat'))
    expect(receipt.session).toBe('main')
    expect(receipt.ticketId).toBeNull()
  })

  it('registers the kind on a sketch host', () => {
    const seen: string[] = []
    apply({ orchestrator: { sources: { register: (kind) => seen.push(kind.kind) } } })
    expect(seen).toEqual([inboxKind.kind])
  })
})
