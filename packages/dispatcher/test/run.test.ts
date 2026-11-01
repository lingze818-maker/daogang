import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Board } from '@daogang/board'
import { LocalInbox } from '@daogang/inbox-source'
import { describe, expect, it } from 'vitest'
import { createFlashRouter } from '../src/flash.ts'
import { DshExecutorAdapter, LocalExecutor, type ExecutorPort } from '../src/executor.ts'
import { DaogangError, dispatchLine, type Runtime } from '../src/run.ts'
import { WorkerLane } from '../src/worker.ts'

function runtime(
  home: string,
  flash?: Runtime['flash'],
  ticketIds?: string[],
  executor?: ExecutorPort,
): Runtime {
  let cursor = 0
  return {
    board: new Board(join(home, 'board.jsonl')),
    inbox: new LocalInbox(join(home, 'inbox.json'), () => ticketIds?.[cursor++] ?? 'abcd1234'),
    flash: flash ?? { async route() { return null } },
    workers: new WorkerLane(join(home, 'worker.json')),
    executor: executor ?? new LocalExecutor(join(home, 'executor.json')),
  }
}

describe('dispatchLine', () => {
  it('prints a worker decision and writes one audit row', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home)
    const output = await dispatchLine('帮我补上安装说明', rt, { messageId: 'm1', now: new Date('2026-11-01T12:00:00.000Z') })
    expect(output.target).toBe('worker')
    expect(output.urgency).toBe(1)
    expect(output.cards[0]).toMatchObject({ role: 'docs', kind: 'task' })
    expect(output.runtime).toBe('local-inbox')
    expect(output.executor).toBe('local')
    expect((rt.executor as LocalExecutor).load().launches).toHaveLength(1)
    expect((rt.executor as LocalExecutor).load().launches[0]?.text).toContain('安装说明')
    expect(output.mainReply).toBeNull()
    expect(output.interrupt).toBeNull()
    expect(output.claims).toEqual([])
    expect(output.receipts[0]).toMatchObject({
      status: 'accepted',
      session: 'worker-abcd1234',
      ticketId: 'abcd1234',
    })
    const rows = rt.board.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      input: '帮我补上安装说明',
      handoffNote: '',
      status: 'accepted',
      via: 'rules',
    })
  })

  it('accepts mixed input on main and a worker session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const output = await dispatchLine('谢谢，帮我修一下 bug', runtime(home), { messageId: 'mix' })
    expect(output.target).toBe('mixed')
    expect(output.mainReply).toMatchObject({ channel: 'main-stub', session: 'main' })
    expect(output.mainReply?.text).toContain('谢谢')
    expect(output.receipts.map((item) => item.session)).toEqual(['main', 'worker-abcd1234'])
  })

  it('replies on main before the task lane continues', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const events: string[] = []
    let taskWaiting = false
    const pending = dispatchLine('谢谢，帮我修一下 bug', runtime(home), {
      messageId: 'mix',
      onMain: () => { events.push('main') },
      beforeTask: async () => {
        events.push('task')
        taskWaiting = true
        await gate
      },
    })
    for (let i = 0; i < 20 && !taskWaiting; i += 1) await Promise.resolve()
    expect(taskWaiting).toBe(true)
    expect(events).toEqual(['main', 'task'])
    release()
    const output = await pending
    expect(output.mainReply?.text).toContain('谢谢')
    expect(output.receipts.map((item) => item.lane)).toEqual(['chat', 'task'])
  })

  it('replays the same id as duplicate without a second session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home)
    await dispatchLine('帮我补上安装说明', rt, { messageId: 'm1' })
    const again = await dispatchLine('帮我补上安装说明', rt, { messageId: 'm1' })
    expect(again.receipts[0]?.status).toBe('duplicate')
    expect(again.receipts[0]?.session).toBe('worker-abcd1234')
    expect(rt.board.list()).toHaveLength(2)
  })

  it('uses a valid flash payload', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home, {
      async route() {
        return {
          target: 'worker',
          urgency: 2,
          cards: [{ role: 'fix', kind: 'task', summary: '立刻修' }],
        }
      },
    })
    const output = await dispatchLine('马上看看', rt, { messageId: 'flash' })
    expect(output.via).toBe('flash')
    expect(output.urgency).toBe(2)
    expect(output.reason).toBe('Flash 路由')
    expect(output.cards[0]).toMatchObject({ role: 'fix', summary: '立刻修' })
  })

  it('falls back when flash throws and does not store the key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const secret = 'sk-test-should-not-land'
    const rt = runtime(home, createFlashRouter({ DEEPSEEK_API_KEY: secret }, async () => {
      throw new Error(`authorization Bearer ${secret}`)
    }))
    const output = await dispatchLine('你好', rt, { messageId: 'fallback' })
    expect(output.via).toBe('rules')
    expect(output.target).toBe('main')
    const dumped = readFileSync(rt.board.file, 'utf8') + readFileSync(join(home, 'inbox.json'), 'utf8')
    expect(dumped).not.toContain(secret)
  })

  it('interrupts a busy worker and leaves a handoff note on that row', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home, undefined, ['aaaa1111', 'bbbb2222'])
    await dispatchLine('帮我补上安装说明', rt, { messageId: 'low' })
    const urgent = await dispatchLine('马上帮我修一下', rt, { messageId: 'high' })
    expect(urgent.interrupt?.paused.session).toBe('worker-aaaa1111')
    expect(urgent.interrupt?.now.session).toBe('worker-bbbb2222')
    const note = urgent.interrupt?.paused.handoffNote ?? ''
    expect(note).toContain('帮我补上安装说明')
    expect(Array.from(note).length).toBeLessThanOrEqual(200)
    const rows = rt.board.list()
    expect(rows[0]).toMatchObject({ status: 'queued', handoffNote: note })
    expect(rows[0]?.receipts[0]).toMatchObject({ disposition: 'queued' })
    expect(rows[1]).toMatchObject({ status: 'accepted' })
    expect(rt.workers.load().busy?.session).toBe('worker-bbbb2222')
    expect(rt.workers.load().queue.map((slot) => slot.session)).toEqual(['worker-aaaa1111'])
  })

  it('queues a less urgent task without a handoff snapshot', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home, undefined, ['aaaa1111', 'bbbb2222'])
    await dispatchLine('马上帮我修一下', rt, { messageId: 'high' })
    const later = await dispatchLine('不急，帮我写文档', rt, { messageId: 'low' })
    expect(later.interrupt).toBeNull()
    expect(later.receipts[0]?.disposition).toBe('queued')
    const rows = rt.board.list()
    expect(rows[0]).toMatchObject({ status: 'accepted', handoffNote: '' })
    expect(rows[1]).toMatchObject({ status: 'queued' })
    expect(rt.workers.load().busy?.session).toBe('worker-aaaa1111')
  })

  it('appends a claim row when receive fails and still keeps the main reply', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home)
    const mixed = await dispatchLine('谢谢，帮我修一下 bug', rt, { messageId: 'mix', failLane: 'task' })
    expect(mixed.mainReply?.text).toContain('谢谢')
    expect(mixed.receipts.map((item) => item.lane)).toEqual(['chat'])
    expect(mixed.claims[0]?.reason).toContain('招领')
    expect(mixed.claims[0]?.reason).toContain('目标离线或超时')
    expect(rt.board.list().some((row) => row.status === 'accepted')).toBe(true)
    expect(rt.board.list().some((row) => row.status === 'claim')).toBe(true)

    const home2 = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const only = runtime(home2)
    const failed = await dispatchLine('帮我补上安装说明', only, { messageId: 'off', failLane: 'task' })
    expect(failed.receipts).toEqual([])
    expect(failed.mainReply).toBeNull()
    expect(only.board.list()).toHaveLength(1)
    expect(only.board.list()[0]).toMatchObject({ status: 'claim' })
    expect(failed.audit.id).toBe(only.board.list()[0]?.id)
    expect(only.workers.load().busy).toBeNull()
  })

  it('does not launch a queued task, and a DSH adapter claims instead of starting', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const local = new LocalExecutor(join(home, 'executor.json'))
    const rt = runtime(home, undefined, ['aaaa1111', 'bbbb2222'], local)
    await dispatchLine('马上帮我修一下', rt, { messageId: 'high' })
    await dispatchLine('不急，帮我写文档', rt, { messageId: 'low' })
    expect(local.load().launches).toHaveLength(1)
    expect(local.load().launches[0]?.session).toBe('worker-aaaa1111')

    const home2 = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const dsh = runtime(home2, undefined, undefined, new DshExecutorAdapter())
    const failed = await dispatchLine('帮我补上安装说明', dsh, { messageId: 'dsh' })
    expect(failed.executor).toBe('dsh')
    expect(failed.claims[0]?.reason).toContain('DSH 未接线')
    expect(failed.claims[0]?.reason).toContain('launch')
    expect(dsh.workers.load().busy).toBeNull()
    expect(dsh.board.list()[0]?.status).toBe('claim')
  })

  it('rejects an empty line before writing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home)
    await expect(dispatchLine('   ', rt)).rejects.toBeInstanceOf(DaogangError)
    expect(rt.board.list()).toHaveLength(0)
  })
})
