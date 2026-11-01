import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createExecutor,
  DshExecutorAdapter,
  DshNotWiredError,
  LocalExecutor,
  planDshDeliver,
  planDshStart,
  workerSessionId,
  type ExecutorAssignment,
} from '../src/executor.ts'

const assignment: ExecutorAssignment = {
  ticketId: 'abcd1234',
  session: 'worker-abcd1234',
  assignmentId: 'audit-1',
  urgency: 1,
  cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
  text: '补上安装说明',
  handoffNote: '',
}

describe('executor port', () => {
  it('records a local launch and a later delivery', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-exec-'))
    const executor = new LocalExecutor(join(home, 'executor.json'))
    const launch = await executor.start(assignment)
    expect(launch).toEqual({ runtime: 'local', session: 'worker-abcd1234', ticketId: 'abcd1234' })
    await executor.deliver({ ticketId: 'abcd1234', session: 'worker-abcd1234', text: '续一句' })
    expect(executor.load().launches).toHaveLength(1)
    expect(executor.load().deliveries[0]?.text).toBe('续一句')
  })

  it('plans the upstream launch and delivery call sites without loading DSH', async () => {
    expect(workerSessionId('abcd1234')).toBe('worker-abcd1234')
    expect(planDshStart(assignment)).toEqual({
      method: 'start',
      effect: 'launch',
      session: 'worker-abcd1234',
      payload: { ticketId: 'abcd1234', assignmentId: 'audit-1' },
    })
    expect(planDshDeliver({ ticketId: 'abcd1234', session: 'worker-abcd1234', text: '续一句' })).toEqual({
      method: 'deliver',
      effect: 'delivery',
      session: 'worker-abcd1234',
      payload: { ticketId: 'abcd1234' },
    })
    const adapter = new DshExecutorAdapter()
    await expect(adapter.start(assignment)).rejects.toBeInstanceOf(DshNotWiredError)
    await expect(adapter.deliver({ ticketId: 'abcd1234', session: 'worker-abcd1234', text: '续' })).rejects.toMatchObject({
      call: { method: 'deliver', effect: 'delivery' },
    })
  })

  it('selects the local executor unless DAOGANG_EXECUTOR=dsh', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-exec-'))
    expect(createExecutor(home, {}).kind).toBe('local')
    expect(createExecutor(home, { DAOGANG_EXECUTOR: 'dsh' }).kind).toBe('dsh')
  })
})