import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendTrigger, watchTriggerLog } from '../src/trigger-log.ts'
import { inboxTrigger } from '../src/trigger.ts'
import type { InboxTrigger } from '../src/trigger.ts'
import type { Decision } from '../src/decision.ts'

function triggerOf(id: string): InboxTrigger {
  const decision: Decision = {
    target: 'worker',
    urgency: 1,
    cards: [{ role: 'worker', kind: 'task', summary: `任务 ${id}` }],
  }
  return inboxTrigger({ messageId: id, at: '2026-11-02T00:00:00.000Z', text: `帮我做 ${id}`, decision, lane: 'task' })
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('trigger-log 文件桥（issue #24）', () => {
  it('append 后 watch 收到；同 id 不重发；新增 id 再收到', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daogang-bridge-'))
    dirs.push(dir)
    const file = join(dir, 'triggers.jsonl')
    const got: string[] = []
    const controller = new AbortController()
    const stop = watchTriggerLog(file, t => got.push(t.id), controller.signal, { intervalMs: 20 })

    appendTrigger(file, triggerOf('m1'))
    await vi.waitFor(() => expect(got).toEqual(['inbox:m1:task']))

    appendTrigger(file, triggerOf('m1')) // duplicate：LocalInbox 不会走到这，但桥侧也要幂等
    appendTrigger(file, triggerOf('m2'))
    await vi.waitFor(() => expect(got).toEqual(['inbox:m1:task', 'inbox:m2:task']))

    stop()
    controller.abort()
    appendTrigger(file, triggerOf('m3'))
    await new Promise(r => setTimeout(r, 60))
    expect(got).toEqual(['inbox:m1:task', 'inbox:m2:task']) // 停止后不再收
  })

  it('文件不存在视为空；坏行跳过不阻塞后续；非 inbox source 行忽略', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'daogang-bridge-'))
    dirs.push(dir)
    const file = join(dir, 'triggers.jsonl')
    const got: string[] = []
    const controller = new AbortController()
    const stop = watchTriggerLog(file, t => got.push(t.id), controller.signal, { intervalMs: 20 })
    await new Promise(r => setTimeout(r, 40))
    expect(got).toEqual([])

    writeFileSync(file, '{"broken json\n{"source":"github","id":"x"}\n', 'utf8')
    const t = triggerOf('m9')
    appendTrigger(file, t)
    await vi.waitFor(() => expect(got).toEqual(['inbox:m9:task']))

    stop()
    controller.abort()
  })

  it('append 的行可被读回（往返一致）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daogang-bridge-'))
    dirs.push(dir)
    const file = join(dir, 'triggers.jsonl')
    const t = triggerOf('m7')
    appendTrigger(file, t)
    const line = readFileSync(file, 'utf8').trim()
    expect((JSON.parse(line) as InboxTrigger).id).toBe('inbox:m7:task')
    expect((JSON.parse(line) as InboxTrigger).text).toContain('帮我做 m7')
  })
})
