#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { loadEnvFile, readFailLane } from './env.ts'
import { DaogangError, dispatchLine, openRuntime, resolveHome } from './run.ts'

interface Parsed {
  command: string
  home?: string
  messageId?: string
  text: string[]
  help: boolean
}

export function parseArgs(argv: string[]): Parsed {
  const parsed: Parsed = { command: '', text: [], help: false }
  const rest = [...argv]
  parsed.command = rest.shift() ?? ''
  while (rest.length > 0) {
    const token = rest[0] ?? ''
    if (token === '--') {
      rest.shift()
      parsed.text.push(...rest)
      break
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true
      rest.shift()
      continue
    }
    if (token === '--home') {
      rest.shift()
      const value = rest.shift()
      if (!value) throw new DaogangError('--home 需要一个目录')
      parsed.home = value
      continue
    }
    if (token === '--id') {
      rest.shift()
      const value = rest.shift()
      if (!value) throw new DaogangError('--id 需要一个消息 id')
      parsed.messageId = value
      continue
    }
    if (token.startsWith('-')) throw new DaogangError(`未知参数 ${token}`)
    parsed.text.push(token)
    rest.shift()
  }
  return parsed
}

const HELP = `到岗分发器

  pnpm dispatch -- "一句话"
  pnpm listen
  pnpm board

无 DEEPSEEK_API_KEY 时用关键词兜底。审计写在 DAOGANG_HOME（默认 ./.daogang）。
接单回执来自本地 inbox，不是 DSH worker Session。
默认 LocalExecutor。DAOGANG_EXECUTOR=dsh 且没设 DAOGANG_DSH_ROOT 时派工落招领。
设了 DAOGANG_DSH_ROOT 才会按路径调用克隆里的 start/deliver enqueue。
闲聊走主窗桩回复，和任务腿分开，互不等待。
更急的新任务会把正在忙的工单改成排队，并写上不超过 200 字的交接备注。
DAOGANG_FAIL_LANE=task 时这一腿改为招领行，而不是静默失败。
`

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${JSON.stringify({ error: message })}\n`)
  process.exit(error instanceof DaogangError ? 1 : 2)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function oneLine(args: Parsed): Promise<void> {
  const joined = args.text.join(' ').trim()
  let text = joined
  if (!text) {
    if (process.stdin.isTTY) throw new DaogangError('请在参数或标准输入里给出一句话')
    text = (await readStdin()).split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  }
  const runtime = openRuntime(resolveHome(args.home))
  const output = await dispatchLine(text, runtime, { messageId: args.messageId, failLane: readFailLane() })
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

async function listen(args: Parsed): Promise<void> {
  if (args.messageId) throw new DaogangError('--id 只用于 dispatch')
  const runtime = openRuntime(resolveHome(args.home))
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    if (!line.trim()) continue
    const output = await dispatchLine(line, runtime, { failLane: readFailLane() })
    process.stdout.write(`${JSON.stringify(output)}\n`)
  }
}

function showBoard(args: Parsed): void {
  const runtime = openRuntime(resolveHome(args.home))
  const rows = runtime.board.list()
  process.stdout.write(`# ${runtime.board.file}\n`)
  if (rows.length === 0) {
    process.stdout.write('（还没有审计行）\n')
    return
  }
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`)
}

async function main(): Promise<void> {
  loadEnvFile(process.cwd())
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.command) {
    process.stdout.write(HELP)
    return
  }
  if (args.command === 'dispatch') {
    await oneLine(args)
    return
  }
  if (args.command === 'listen') {
    await listen(args)
    return
  }
  if (args.command === 'board') {
    showBoard(args)
    return
  }
  throw new DaogangError(`未知命令 ${args.command}`)
}

function invokedDirectly(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return import.meta.url === pathToFileURL(entry).href
  }
}

if (invokedDirectly()) {
  main().catch(fail)
}
