import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Board } from '@daogang/board'
import { LocalInbox } from '@daogang/inbox-source'
import { describe, expect, it } from 'vitest'
import { createFlashRouter } from '../src/flash.ts'
import { DaogangError, dispatchLine, type Runtime } from '../src/run.ts'

function runtime(home: string, flash?: Runtime['flash']): Runtime {
  return {
    board: new Board(join(home, 'board.jsonl')),
    inbox: new LocalInbox(join(home, 'inbox.json'), () => 'abcd1234'),
    flash: flash ?? { async route() { return null } },
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
    expect(output.receipts.map((item) => item.session)).toEqual(['main', 'worker-abcd1234'])
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

  it('rejects an empty line before writing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'daogang-run-'))
    const rt = runtime(home)
    await expect(dispatchLine('   ', rt)).rejects.toBeInstanceOf(DaogangError)
    expect(rt.board.list()).toHaveLength(0)
  })
})
