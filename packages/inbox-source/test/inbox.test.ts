import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  apply,
  InboxFeed,
  inboxKind,
  inboxScope,
  inboxTrigger,
  inject,
  LocalInbox,
  name,
  type Decision,
  type InboxHealth,
  type InboxLoopHost,
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
    expect(name).toBe('daogang-inbox')
    expect([...inject]).toEqual(['orchestrator'])
    expect(inboxKind.scope({ meta: { conversation: 'other' } }, { conversation: 'cli' }).reason).toBe('conversation_not_listed')
    expect(inboxKind.policy.rows({ conversation: 'cli' })[0]?.id).toBe('cli')
  })

  it('registers scope on a cordis-shaped host and receives one trigger', async () => {
    const feed = new InboxFeed()
    const received: string[] = []
    let registered: typeof inboxKind | undefined
    const unregistered: string[] = []
    const disposers: Array<() => void | Promise<void>> = []
    let release: () => void = () => {}
    const receivedGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const source: InboxLoopHost = {
      ready: Promise.resolve(),
      configured: () => true,
      config: () => ({ conversation: 'cli' }),
      receive: (item) => {
        received.push(item.id)
        release()
        return 'stored'
      },
      report: () => {},
    }
    apply({
      inboxFeed: feed,
      orchestrator: {
        sources: {
          register: (kind) => {
            registered = kind
          },
          unregister: (kind) => unregistered.push(kind),
        },
        context: (kind) => {
          expect(kind.scope({ meta: { conversation: 'cli' } }, { conversation: 'cli' }).listened).toBe(true)
          return source
        },
      },
      effect(run) {
        const done = run()
        if (typeof done === 'function') disposers.push(done)
      },
    })
    expect(registered?.kind).toBe('inbox')
    const built = trigger()
    feed.push({ ...built, meta: { ...built.meta, conversation: 'other' } })
    await receivedGate
    expect(received).toEqual(['inbox:m1:task'])
    for (const dispose of disposers.reverse()) await dispose()
    expect(unregistered).toEqual(['inbox'])
  })

  it('reports setupPending and does not receive while setup is waiting', async () => {
    const feed = new InboxFeed()
    const received: string[] = []
    const reports: InboxHealth[] = []
    let release: () => void = () => {}
    const reported = new Promise<void>((resolve) => {
      release = resolve
    })
    apply({
      inboxFeed: feed,
      orchestrator: {
        sources: { register: () => {} },
        context: () => ({
          ready: Promise.resolve(),
          configured: () => false,
          receive: (item) => {
            received.push(item.id)
            return 'stored'
          },
          report: (_entry, health) => {
            reports.push(health)
            release()
          },
        }),
      },
      effect(run) {
        run()
      },
    })
    feed.push(trigger())
    await reported
    expect(received).toEqual([])
    expect(reports[0]).toMatchObject({ state: 'paused', code: 'setupPending' })
  })

  it('ships a disabled cordis patch and a package export', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('id: daogang-inbox')
    expect(patch).toContain("name: '@daogang/inbox-source'")
    expect(patch).toContain('disabled: true')
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: { '.': string }
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(pkg.exports['.']).toBe('./src/index.ts')
    expect(pkg.dependencies?.['@deepseek-ai/cordis']).toBeUndefined()
    expect(pkg.peerDependencies?.['@deepseek-ai/cordis']).toBeUndefined()
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })
})
