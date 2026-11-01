#!/usr/bin/env node
// 把 scripts/demo.sh 的同一步骤录成 asciinema v2。不依赖 asciinema 二进制。
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'packages/dispatcher/src/cli.ts')
const home = mkdtempSync(join(tmpdir(), 'daogang-cast-'))
const env = {
  ...process.env,
  DAOGANG_HOME: home,
  DEEPSEEK_API_KEY: '',
  DAOGANG_FAIL_LANE: '',
  DAOGANG_EXECUTOR: 'local',
  DAOGANG_DSH_ROOT: '',
}
const steps = [
  ['dispatch', '--', '帮我补上安装说明'],
  ['dispatch', '--', '谢谢，马上帮我修一下 bug'],
  ['dispatch', '--', '不急，帮我写文档'],
  ['dispatch', '--', '帮我排查安装'],
  ['board'],
]

const events = []
let clock = 0
function push(text, gap = 0.35) {
  clock += gap
  events.push([Number(clock.toFixed(3)), 'o', text])
}

push('$ export DAOGANG_HOME=$(mktemp -d)\n$ # 不需要 DEEPSEEK_API_KEY\n', 0.1)
for (const [index, args] of steps.entries()) {
  const fail = index === 3
  const shown = fail
    ? `DAOGANG_FAIL_LANE=task pnpm dispatch -- "${args[2]}"\n`
    : args[0] === 'board'
      ? 'pnpm board\n'
      : `pnpm dispatch -- "${args[2]}"\n`
  push(`$ ${shown}`, 0.2)
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...env, DAOGANG_FAIL_LANE: fail ? 'task' : '' },
  })
  const body = `${result.stdout}${result.stderr}`
  if (result.status !== 0) {
    process.stderr.write(body)
    process.exit(result.status ?? 1)
  }
  push(body.endsWith('\n') ? body : `${body}\n`, 0.15)
}

const header = {
  version: 2,
  width: 120,
  height: 36,
  timestamp: Math.floor(Date.now() / 1000),
  title: 'daogang 0.1.0-peripheral',
  env: { SHELL: '/bin/bash', TERM: 'xterm-256color' },
}
const out = join(root, 'docs/demo/peripheral.cast')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(header)}\n${events.map((event) => JSON.stringify(event)).join('\n')}\n`)
process.stdout.write(`wrote ${out}\n`)
