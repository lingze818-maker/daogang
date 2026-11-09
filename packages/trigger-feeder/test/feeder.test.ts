import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendTrigger, type InboxTrigger } from '@daogang/inbox-source'
import { startTriggerFeeder, type TriggerStoreLike } from '../src/feeder.ts'

function triggerOf(id: string): InboxTrigger {
  return {
    id: `inbox:${id}:task`,
    source: 'inbox',
    threads: [{ source: 'inbox', id: `cli:${id}` }],
    actor: { source: 'inbox', id: 'cli-user' },
    human: true,
    addressed: 'direct',
    at: '2026-11-09T00:00:00.000Z',
    text: `帮我做 ${id}`,
    channel: { source: 'inbox', thread: `inbox:cli:${id}`, address: { conversation: 'cli', message: id } },
    meta: { conversation: 'cli', messageId: id, lane: 'task', policy: 'explicit' },
  } as InboxTrigger
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'daogang-feeder-'))
  dirs.push(dir)
  return dir
}

describe('trigger-feeder 三段组合（issue #34，鎏涟 2026-11-09 定案）', () => {
  it('假 jsonl 新行 → 假 Store.save + 假 requeue 依次收到；同 id 不重投', async () => {
    const dir = scratch()
    const logFile = join(dir, 'triggers.jsonl')
    const saved: string[] = []
    const requeued: string[] = []
    const store: TriggerStoreLike = { save: (t) => saved.push(t.id) }
    const controller = new AbortController()
    const feeder = startTriggerFeeder({
      logFile,
      signal: controller.signal,
      store,
      requeue: async (id) => {
        requeued.push(id)
        return true
      },
      intervalMs: 20,
    })

    appendTrigger(logFile, triggerOf('m1'))
    await vi.waitFor(() => expect(requeued).toEqual(['inbox:m1:task']))
    expect(saved).toEqual(['inbox:m1:task'])

    // 同 id 追加（LocalInbox 不会发生，桥侧也要幂等）：watchTriggerLog 按 seen 去重，feeder 不再收
    appendTrigger(logFile, triggerOf('m1'))
    appendTrigger(logFile, triggerOf('m2'))
    await vi.waitFor(() => expect(requeued).toEqual(['inbox:m1:task', 'inbox:m2:task']))
    expect(feeder.stats()).toMatchObject({ delivered: 2, requeued: 2, pending: 0 })

    feeder.stop()
    controller.abort()
  })

  it('stateFile 落盘：重启后已投 id 不重投，新 id 照投', async () => {
    const dir = scratch()
    const logFile = join(dir, 'triggers.jsonl')
    const stateFile = join(dir, 'feeder-state.json')
    const requeued: string[] = []
    const controller = new AbortController()
    const first = startTriggerFeeder({
      logFile,
      signal: controller.signal,
      store: { save: () => {} },
      requeue: async (id) => { requeued.push(id); return true },
      stateFile,
      intervalMs: 20,
    })
    appendTrigger(logFile, triggerOf('a1'))
    await vi.waitFor(() => expect(requeued).toEqual(['inbox:a1:task']))
    await vi.waitFor(() => expect(() => readFileSync(stateFile, 'utf8')).toBeTruthy())
    first.stop()
    controller.abort()

    // 重启：新 feeder 继承 state，a1 不重投
    const controller2 = new AbortController()
    const second = startTriggerFeeder({
      logFile,
      signal: controller2.signal,
      store: { save: () => {} },
      requeue: async (id) => { requeued.push(id); return true },
      stateFile,
      intervalMs: 20,
    })
    appendTrigger(logFile, triggerOf('a2'))
    await vi.waitFor(() => expect(requeued).toEqual(['inbox:a1:task', 'inbox:a2:task']))
    second.stop()
    controller2.abort()
  })

  it('requeue 失败（服务没在跑）不丢：进重试队列，恢复后补投', async () => {
    const dir = scratch()
    const logFile = join(dir, 'triggers.jsonl')
    const saved: string[] = []
    const requeued: string[] = []
    let down = true
    const controller = new AbortController()
    const feeder = startTriggerFeeder({
      logFile,
      signal: controller.signal,
      store: { save: (t) => saved.push(t.id) },
      requeue: async (id) => {
        if (down) throw new Error('ECONNREFUSED')
        requeued.push(id)
        return true
      },
      stateFile: join(dir, 'feeder-state.json'),
      intervalMs: 20,
      retryMs: 40,
    })

    appendTrigger(logFile, triggerOf('r1'))
    await vi.waitFor(() => expect(saved).toEqual(['inbox:r1:task']))
    expect(feeder.stats().pending).toBe(1)

    down = false // 服务回来了
    await vi.waitFor(() => expect(requeued).toEqual(['inbox:r1:task']))
    await vi.waitFor(() => expect(feeder.stats().pending).toBe(0))

    feeder.stop()
    controller.abort()
  })

  it('Store.save 抛错也进重试；坏行跳过不阻塞后续', async () => {
    const dir = scratch()
    const logFile = join(dir, 'triggers.jsonl')
    let broken = true
    const saved: string[] = []
    const requeued: string[] = []
    const controller = new AbortController()
    const feeder = startTriggerFeeder({
      logFile,
      signal: controller.signal,
      store: { save: (t) => {
        if (broken) throw new Error('database is locked')
        saved.push(t.id)
      } },
      requeue: async (id) => { requeued.push(id); return true },
      intervalMs: 20,
      retryMs: 40,
    })

    writeFileSync(logFile, '{"broken json\n', 'utf8') // 坏行：watchTriggerLog 跳过
    appendTrigger(logFile, triggerOf('b1'))
    await vi.waitFor(() => expect(feeder.stats().failed).toBeGreaterThan(0))
    broken = false
    await vi.waitFor(() => expect(saved).toEqual(['inbox:b1:task']))
    expect(requeued).toEqual(['inbox:b1:task'])

    feeder.stop()
    controller.abort()
  })
})
