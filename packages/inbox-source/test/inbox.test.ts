import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  apply,
  CARD_MARK,
  cardBlock,
  InboxFeed,
  inboxConfigSchema,
  inboxKind,
  inboxPolicySchema,
  inboxScope,
  inboxTrigger,
  inject,
  LocalInbox,
  name,
  textWithCards,
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
    apply({ orchestrator: { sources: { register: (kind) => { seen.push(kind.kind) } } } })
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

  it('ships a disabled cordis patch and a package export', async () => {
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
    const built = await import('../lib/index.js')
    expect(built.name).toBe('daogang-inbox')
    expect(typeof built.apply).toBe('function')
    expect(typeof built.inboxKind.schema.safeParse).toBe('function')
    expect(built.inboxKind.schema.parse({})).toEqual({ conversation: 'cli' })
  })

  it('parses config and policy with zod safeParse, and rejects a bad conversation', () => {
    expect(inboxConfigSchema.safeParse({}).success).toBe(true)
    expect(inboxConfigSchema.parse({})).toEqual({ conversation: 'cli' })
    expect(inboxKind.schema.parse({ conversation: 'ops' })).toEqual({ conversation: 'ops' })
    expect(inboxConfigSchema.safeParse({ conversation: 'Ops' }).success).toBe(false)
    expect(inboxConfigSchema.safeParse({ conversation: 'cli', extra: true }).success).toBe(false)
    expect(inboxPolicySchema.parse({})).toEqual({ allowed: [] })
    expect(inboxPolicySchema.safeParse({ allowed: [{ id: 'cli-user', name: 'cli' }] }).success).toBe(true)
    expect(inboxPolicySchema.safeParse({ allowed: [{ id: '' }] }).success).toBe(false)
    expect(inboxKind.policy.schema).toBe(inboxPolicySchema)
    expect(inboxKind.policy.fields[0]?.key).toBe('allowed')
  })

  it('registers on a context that rejects unknown fields', async () => {
    const seen: string[] = []
    const reports: string[] = []
    let release: () => void = () => {}
    const reported = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = {
      sources: {
        register: (kind: { kind: string }) => {
          seen.push(kind.kind)
          return () => {}
        },
      },
      context() {
        return {
          ready: Promise.resolve(),
          configured: () => false,
          report(_entry: string, health: { code?: string }) {
            if (health.code) reports.push(health.code)
            release()
          },
        }
      },
    }
    const ctx = new Proxy({
      orchestrator: host,
      effect(run: () => void) {
        run()
      },
    }, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver)
        throw new Error(`cannot get property "${String(prop)}" without inject`)
      },
    })
    apply(ctx as never)
    await reported
    expect(seen).toEqual(['inbox'])
    expect(reports).toEqual(['setupPending'])
  })

  it('calls the disposer returned by register', async () => {
    let disposed = 0
    const disposers: Array<() => void | Promise<void>> = []
    apply({
      orchestrator: {
        sources: {
          register: () => () => {
            disposed += 1
          },
        },
      },
      effect(run) {
        const done = run()
        if (typeof done === 'function') disposers.push(done)
      },
    })
    for (const dispose of disposers.reverse()) await dispose()
    expect(disposed).toBe(1)
  })
})
