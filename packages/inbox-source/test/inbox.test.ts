import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendTrigger,
  CARD_MARK,
  cardBlock,
  inboxScope,
  inboxTrigger,
  LocalInbox,
  textWithCards,
  watchTriggerLog,
  type Decision,
  type InboxTrigger,
} from '../src/index.ts'

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

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('inbox source', () => {
  it('builds a stable explicit trigger', () => {
    const built = trigger()
    expect(built.id).toBe('inbox:m1:task')
    expect(built.source).toBe('inbox')
    expect(built.addressed).toBe('direct')
    expect(built.human).toBe(true)
    expect(built.meta.policy).toBe('explicit')
    expect(built.meta.card).toEqual(decision.cards[0])
    expect(built.meta.cards).toEqual(decision.cards)
    expect(built.text).toBe(textWithCards('帮我补上安装说明', decision.cards))
    expect(built.text).toContain(`${CARD_MARK}\n- docs/task: 补上安装说明`)
    expect(built.threads[0]).toEqual({ source: 'inbox', id: 'cli:m1' })
    expect(inboxScope(built.meta, { conversation: 'cli' })).toEqual({
      listened: true,
      observed: false,
      row: 'cli',
    })
    expect(inboxScope({ conversation: 'other' }, { conversation: 'cli' }).reason).toBe('conversation_not_listed')
  })

  it('keeps only the lane cards in the trigger text', () => {
    const mixed: Decision = {
      target: 'mixed',
      urgency: 2,
      cards: [
        { role: 'main', kind: 'chat', summary: '谢谢' },
        { role: 'docs', kind: 'task', summary: '补上安装说明' },
      ],
    }
    const task = inboxTrigger({
      messageId: 'm1',
      at: '2026-11-01T12:00:00.000Z',
      text: '谢谢，帮我补上安装说明',
      decision: mixed,
      lane: 'task',
    })
    expect(task.meta.cards).toEqual([mixed.cards[1]])
    expect(task.meta.card).toEqual(mixed.cards[1])
    expect(task.text.startsWith('谢谢，帮我补上安装说明')).toBe(true)
    expect(task.text).toContain('docs/task: 补上安装说明')
    expect(task.text).not.toContain('main/chat')
    expect(cardBlock([])).toBe('')
    expect(textWithCards('  ', [])).toBe('  ')
  })

  it('accepts a task into worker-<ticketId> and a replay as duplicate', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-inbox-'))
    dirs.push(home)
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
    dirs.push(home)
    const inbox = new LocalInbox(join(home, 'inbox.json'))
    const receipt = inbox.receive(trigger('chat'))
    expect(receipt.session).toBe('main')
    expect(receipt.ticketId).toBeNull()
  })

  it('delivers triggers.jsonl through watchTriggerLog into LocalInbox once', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-inbox-'))
    dirs.push(home)
    const file = join(home, 'triggers.jsonl')
    const inbox = new LocalInbox(join(home, 'inbox.json'), () => 'abcd1234')
    const got: InboxTrigger[] = []
    const controller = new AbortController()
    const stop = watchTriggerLog(file, (item) => { got.push(item) }, controller.signal, { intervalMs: 20 })

    appendTrigger(file, trigger())
    await vi.waitFor(() => expect(got.map((item) => item.id)).toEqual(['inbox:m1:task']))

    const receipt = inbox.receive(got[0]!)
    expect(receipt).toMatchObject({
      status: 'accepted',
      ticketId: 'abcd1234',
      session: 'worker-abcd1234',
      lane: 'task',
    })
    expect(got[0]?.text).toContain(`${CARD_MARK}\n- docs/task: 补上安装说明`)

    appendTrigger(file, trigger())
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(got).toHaveLength(1)
    expect(inbox.receive(got[0]!).status).toBe('duplicate')

    stop()
    controller.abort()
  })

  it('ships a disabled cordis patch and the file-bridge package export', async () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('id: daogang-inbox')
    expect(patch).toContain("name: '@daogang/inbox-source'")
    expect(patch).toContain('disabled: true')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: { '.': { types: string; default: string } }
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(pkg.exports['.'].default).toBe('./lib/index.js')
    expect(pkg.exports['.'].types).toBe('./lib/index.d.ts')
    expect(pkg.dependencies?.['@deepseek-ai/cordis']).toBeUndefined()
    expect(pkg.peerDependencies?.['@deepseek-ai/cordis']).toBeUndefined()
    expect(pkg.dependencies?.zod).toBe('4.4.3')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const barrel = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(barrel).not.toContain('./plugin.ts')
    const builtSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
    expect(builtSource).not.toContain('plugin.js')
    const built = await import('../lib/index.js') as {
      appendTrigger?: unknown
      watchTriggerLog?: unknown
      LocalInbox?: unknown
      inboxTrigger?: unknown
      apply?: unknown
    }
    expect(typeof built.appendTrigger).toBe('function')
    expect(typeof built.watchTriggerLog).toBe('function')
    expect(typeof built.LocalInbox).toBe('function')
    expect(typeof built.inboxTrigger).toBe('function')
    expect(built.apply).toBeUndefined()
  })
})
