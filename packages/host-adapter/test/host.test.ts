import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Board } from '@daogang/board'
import { handoffFor, LocalExecutor, replyOnMain, WorkerLane, workerSessionId } from '@daogang/dispatcher'
import { describe, expect, it } from 'vitest'
import {
  createHost,
  DuiyingHost,
  DuiyingNotWiredError,
  HostAdapterError,
  LocalCliHost,
} from '../src/index.ts'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'daogang-host-'))
}

describe('LocalCliHost', () => {
  it('sends the same main-window stub as the CLI', async () => {
    const host = new LocalCliHost(home())
    const at = '2026-11-01T12:00:00.000Z'
    const sent = await host.sendMessage({ sessionId: 'main', text: '谢谢', at })
    expect(sent).toEqual({
      sessionId: 'main',
      text: replyOnMain({ summary: '谢谢', at }).text,
      at,
    })
    expect(host.id).toBe('local-cli')
  })

  it('names a worker session and delivers on the local executor', async () => {
    const dir = home()
    const host = new LocalCliHost(dir)
    const opened = await host.openSession({ kind: 'worker', ticketId: 'abcd1234' })
    expect(opened).toEqual({ id: 'worker-abcd1234', kind: 'worker' })
    expect(workerSessionId('abcd1234')).toBe(opened.id)
    await host.sendMessage({ sessionId: opened.id, text: '续一句', at: '2026-11-01T12:00:00.000Z' })
    const stored = new LocalExecutor(join(dir, 'executor.json')).load()
    expect(stored.deliveries[0]?.text).toBe('续一句')
    expect(stored.launches).toEqual([])
  })

  it('interrupts only a busier session and keeps the handoff on the board', async () => {
    const dir = home()
    const host = new LocalCliHost(dir)
    const busy = {
      ticketId: 'aaaa1111',
      session: 'worker-aaaa1111',
      auditId: 'audit-busy',
      urgency: 1 as const,
      summary: '补上安装说明',
    }
    new WorkerLane(join(dir, 'worker.json')).save({ busy, queue: [] })
    new Board(join(dir, 'board.jsonl')).append({
      id: 'audit-busy',
      at: '2026-11-01T12:00:00.000Z',
      input: '帮我补上安装说明',
      target: 'worker',
      urgency: 1,
      cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
      via: 'rules',
      reason: '关键词',
      handoffNote: '',
      status: 'accepted',
      receipts: [{
        status: 'accepted',
        triggerId: 'inbox:m1:task',
        ticketId: 'aaaa1111',
        session: 'worker-aaaa1111',
        lane: 'task',
        disposition: 'running',
      }],
    })

    const same = host.interrupt({
      sessionId: busy.session,
      incoming: { ticketId: 'bbbb2222', summary: '稍后写', urgency: 1, auditId: 'audit-next' },
    })
    await expect(same).rejects.toBeInstanceOf(HostAdapterError)
    expect(new WorkerLane(join(dir, 'worker.json')).load().busy?.session).toBe(busy.session)

    const result = await host.interrupt({
      sessionId: busy.session,
      incoming: { ticketId: 'bbbb2222', summary: '马上修', urgency: 2, auditId: 'audit-next' },
    })
    expect(result.pausedSessionId).toBe(busy.session)
    expect(result.nowSessionId).toBe('worker-bbbb2222')
    expect(result.handoffNote).toBe(handoffFor(busy))
    expect(Array.from(result.handoffNote).length).toBeLessThanOrEqual(200)
    const state = new WorkerLane(join(dir, 'worker.json')).load()
    expect(state.busy?.session).toBe('worker-bbbb2222')
    expect(state.queue.map((item) => item.session)).toEqual([busy.session])
    expect(new Board(join(dir, 'board.jsonl')).list()[0]).toMatchObject({
      status: 'queued',
      handoffNote: result.handoffNote,
    })
    const context = await host.readContext(busy.session)
    expect(context.text).toBe('补上安装说明')
    expect(context.handoffNote).toBe(result.handoffNote)
    expect(new LocalExecutor(join(dir, 'executor.json')).load().launches).toHaveLength(1)
  })

  it('reports anonymous auth and does not invent a missing session', async () => {
    const host = new LocalCliHost(home())
    await expect(host.auth()).resolves.toMatchObject({ state: 'anonymous' })
    await expect(host.readContext('worker-missing')).rejects.toBeInstanceOf(HostAdapterError)
    await expect(host.openSession({ kind: 'worker' })).rejects.toBeInstanceOf(HostAdapterError)
  })
})

describe('DuiyingHost', () => {
  it('stays unwired and does not describe an endpoint', async () => {
    const host = new DuiyingHost()
    await expect(host.auth()).resolves.toMatchObject({ state: 'unconfigured' })
    for (const run of [
      () => host.sendMessage({ sessionId: 'main', text: '你好' }),
      () => host.openSession({ kind: 'main' }),
      () => host.interrupt({
        sessionId: 'main',
        incoming: { ticketId: 't', summary: 'x', urgency: 1, auditId: 'a' },
      }),
      () => host.readContext('main'),
    ]) {
      const error = await run().then(() => {
        throw new Error('应该拒绝')
      }, (caught: unknown) => caught)
      expect(error).toBeInstanceOf(DuiyingNotWiredError)
      expect((error as Error).message).toContain('不访问网络')
      expect((error as Error).message).not.toMatch(/https?:\/\//)
    }
  })
})

describe('createHost', () => {
  it('defaults to the local CLI host', () => {
    const dir = home()
    expect(createHost({ home: dir }).id).toBe('local-cli')
    expect(createHost({ kind: 'duiying' }).id).toBe('duiying')
    expect(() => createHost()).toThrow(HostAdapterError)
  })
})
