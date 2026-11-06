import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendTrigger } from '../src/trigger-log.ts'
import { inboxTrigger } from '../src/trigger.ts'
import type { Decision } from '../src/decision.ts'

function triggerOf(id: string): Parameters<typeof appendTrigger>[1] {
  const decision: Decision = { target: 'worker', urgency: 1, cards: [{ role: 'worker', kind: 'task', summary: id }] }
  return inboxTrigger({ messageId: id, at: '2026-11-02T00:00:00.000Z', text: `t ${id}`, decision, lane: 'task' })
}

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('trigger-log 轮转', () => {
  it('超阈值轮转：当前→.1、旧 .1→.2，新写入继续', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daogang-rot-'))
    dirs.push(dir)
    const file = join(dir, 'triggers.jsonl')
    appendTrigger(file, triggerOf('one'), 100) // 第一条直接写入（未超）
    // 第二条：当前文件已超 100B → 轮转（当前→.1，无 .2），新文件写入第二条
    appendTrigger(file, triggerOf('two'), 100)
    expect(statSync(`${file}.1`).size).toBeGreaterThan(100)
    expect(JSON.parse(readFileSync(file, 'utf8').trim()).id).toBe('inbox:two:task')
    // 第三条：.1 存在 → 先 .1→.2 再当前→.1
    appendTrigger(file, triggerOf('three'), 100)
    expect(statSync(`${file}.2`).size).toBeGreaterThan(100)
    expect(readFileSync(`${file}.1`, 'utf8')).toContain('two')
    expect(JSON.parse(readFileSync(file, 'utf8').trim()).id).toBe('inbox:three:task')
    // 未超阈值的追加不轮转
    const before = statSync(file).size
    appendTrigger(file, triggerOf('four'), 10 * 1024 * 1024)
    expect(statSync(file).size).toBeGreaterThan(before)
    expect(statSync(`${file}.2`).size).toBeGreaterThan(100)
  })
})
