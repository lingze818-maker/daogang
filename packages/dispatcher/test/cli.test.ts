import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/cli.ts'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function run(args: string[], input?: string) {
  const home = mkdtempSync(join(tmpdir(), 'daogang-cli-'))
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: home,
    input,
    encoding: 'utf8',
    env: { ...process.env, DAOGANG_HOME: home, DEEPSEEK_API_KEY: '' },
  })
  return { ...result, home }
}

describe('cli', () => {
  it('parses a one-line dispatch', () => {
    expect(parseArgs(['dispatch', '--id', 'm1', '--', '帮我', '补上'])).toMatchObject({
      command: 'dispatch',
      messageId: 'm1',
      text: ['帮我', '补上'],
    })
  })

  it('dispatches one line to JSON and an audit row', () => {
    const result = run(['dispatch', '--', '帮我补上安装说明'])
    expect(result.status).toBe(0)
    const output = JSON.parse(result.stdout) as {
      target: string
      urgency: number
      cards: unknown[]
      receipts: { session: string; status: string }[]
      audit: { file: string }
    }
    expect(output.target).toBe('worker')
    expect(output.urgency).toBe(1)
    expect(output.cards).toHaveLength(1)
    expect(output.receipts[0]).toMatchObject({ status: 'accepted' })
    expect(output.receipts[0]?.session.startsWith('worker-')).toBe(true)
    const listed = spawnSync(process.execPath, [cli, 'board'], {
      cwd: result.home,
      encoding: 'utf8',
      env: { ...process.env, DAOGANG_HOME: result.home, DEEPSEEK_API_KEY: '' },
    })
    expect(listed.status).toBe(0)
    expect(listed.stdout).toContain(output.receipts[0]?.session)
    expect(listed.stdout).toContain('帮我补上安装说明')
  })

  it('listens on stdin, one JSON object per line', () => {
    const result = run(['listen'], '你好\n\n帮我补上安装说明\n')
    expect(result.status).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] ?? '').target).toBe('main')
    expect(JSON.parse(lines[1] ?? '').target).toBe('worker')
  })

  it('fails closed when dispatch has no input', () => {
    const result = run(['dispatch'], '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('请输入一句话')
  })
})
