import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createExecutor,
  DshExecutorAdapter,
  DshLoadError,
  DshNotWiredError,
  LocalExecutor,
  planDshDeliver,
  planDshStart,
  workerSessionId,
  type ExecutorAssignment,
} from '../src/executor.ts'
import { writeDshFixture } from './dsh-fixture.ts'

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

  it('selects local unless dsh is requested or a root is set', () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-exec-'))
    expect(createExecutor(home, {}).kind).toBe('local')
    expect(createExecutor(home, { DAOGANG_EXECUTOR: 'dsh' }).kind).toBe('dsh')
    expect(createExecutor(home, { DAOGANG_DSH_ROOT: '/tmp/dsh-superagent-prototype' }).kind).toBe('dsh')
    expect(createExecutor(home, { DAOGANG_EXECUTOR: 'local', DAOGANG_DSH_ROOT: '/tmp/dsh' }).kind).toBe('local')
  })

  it('does not load a clone when the root is unset', async () => {
    const adapter = new DshExecutorAdapter()
    await expect(adapter.start(assignment)).rejects.toBeInstanceOf(DshNotWiredError)
    expect(adapter.loadedFrom).toBeUndefined()
    expect(adapter.enqueued).toEqual([])
  })

  it('enqueues launch and delivery through a path-loaded DshExecutor', async () => {
    const root = writeDshFixture(mkdtempSync(join(tmpdir(), 'daogang-dsh-')))
    const adapter = new DshExecutorAdapter({ root })
    const launch = await adapter.start(assignment)
    expect(launch).toEqual({ runtime: 'dsh', session: 'worker-abcd1234', ticketId: 'abcd1234' })
    await adapter.deliver({ ticketId: 'abcd1234', session: 'worker-abcd1234', text: '续一句' })
    expect(adapter.enqueued).toEqual([
      {
        method: 'start',
        effect: 'launch',
        session: 'worker-abcd1234',
        payload: { ticketId: 'abcd1234', assignmentId: 'audit-1' },
        key: 'audit-1',
      },
      {
        method: 'deliver',
        effect: 'delivery',
        session: 'worker-abcd1234',
        payload: { ticketId: 'abcd1234' },
        key: 'abcd1234',
      },
    ])
    const loaded = adapter.loadedFrom
    expect(loaded?.split(/[\\/]/).slice(-3).join('/')).toBe('src/executor/dsh.js')
    const mod = await import(pathToFileURL(loaded ?? '').href) as { timesConstructed: () => number }
    expect(mod.timesConstructed()).toBe(2)
  })

  it('fails clearly when the root is not a dsh-superagent clone and does not import it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daogang-not-dsh-'))
    mkdirSync(join(root, 'src', 'executor'), { recursive: true })
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'daogang' })}\n`)
    writeFileSync(join(root, 'src', 'executor', 'dsh.js'), 'throw new Error("should-not-import")\n')
    const adapter = new DshExecutorAdapter({ root })
    const error = await adapter.start(assignment).then(() => {
      throw new Error('应该失败')
    }, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(DshLoadError)
    expect((error as Error).message).toContain("enqueue('launch')")
    expect((error as Error).message).not.toContain('should-not-import')
    expect(adapter.enqueued).toEqual([])
  })
})