import { describe, expect, it } from 'vitest'
import { HANDOFF_MAX } from '@daogang/board'
import { assignTask, emptyWorkerState, handoffFor, type WorkerSlot } from '../src/worker.ts'

function slot(over: Partial<WorkerSlot> = {}): WorkerSlot {
  return {
    ticketId: 'aaaa1111',
    session: 'worker-aaaa1111',
    auditId: 'audit-a',
    urgency: 1,
    summary: '补上安装说明',
    ...over,
  }
}

describe('assignTask', () => {
  it('starts the first task and does not interrupt equal urgency', () => {
    const first = assignTask(emptyWorkerState(), slot())
    expect(first.disposition).toBe('running')
    expect(first.paused).toBeNull()
    const second = assignTask(first.state, slot({
      ticketId: 'bbbb2222',
      session: 'worker-bbbb2222',
      auditId: 'audit-b',
      urgency: 1,
      summary: '再补一段',
    }))
    expect(second.disposition).toBe('queued')
    expect(second.paused).toBeNull()
    expect(second.handoffNote).toBe('')
    expect(second.state.busy?.session).toBe('worker-aaaa1111')
    expect(second.state.queue.map((item) => item.session)).toEqual(['worker-bbbb2222'])
  })

  it('preempts a lower urgency ticket and clamps the handoff note', () => {
    const busy = assignTask(emptyWorkerState(), slot({ summary: '字'.repeat(300), urgency: 0 }))
    const next = assignTask(busy.state, slot({
      ticketId: 'bbbb2222',
      session: 'worker-bbbb2222',
      auditId: 'audit-b',
      urgency: 2,
      summary: '立刻修',
    }))
    expect(next.disposition).toBe('running')
    const paused = busy.state.busy
    if (!paused) throw new Error('expected a busy slot')
    expect(next.paused?.auditId).toBe('audit-a')
    expect(Array.from(next.handoffNote).length).toBe(HANDOFF_MAX)
    expect(next.handoffNote).toBe(handoffFor(paused))
    expect(next.state.busy?.session).toBe('worker-bbbb2222')
    expect(next.state.queue.map((item) => item.session)).toEqual(['worker-aaaa1111'])
  })
})