#!/usr/bin/env node
/**
 * 无密钥检查 B2 的两段公开路径。
 *
 *   node scripts/check-effects.mjs
 *   DAOGANG_DSH_ROOT=/path/to/dsh-superagent-prototype node scripts/check-effects.mjs
 *
 * 设了根目录、且该克隆已经 pnpm install 时：
 * - 用公开的 Store + Effects（不调用 start）接上 DshExecutor.start / deliver，
 *   核对 effect 表里的 launch / delivery 行。不调用 sessions.prompt，不起 worker Session。
 * - 用公开的 triggerMessage、ticketExecution、inputMessage 核对卡片文本。
 * - 用 Cordis Context.plugin 加一个假 orchestrator，走 configured 真假两条。
 *   不改 cordis.patch.yml 的 disabled: true，不构造 Runtime。
 *   构造 Runtime、Effects.start() 进到 stub sessions.prompt，以及主会话的公开 Session 构造，见 scripts/check-runtime.mjs。
 *
 * 没设根目录时只说明跳过，退出 0。pnpm test 不跑这一段。
 * 打印的结果不含绝对路径。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cardBlock, CARD_MARK, inboxTrigger, textWithCards } from '../packages/inbox-source/src/index.ts'

function brief(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\/[\w.+@~-]+(?:\/[\w.+@~-]+)+/g, '<path>').replace(/\s+/g, ' ').trim().slice(0, 240)
}

const report = {
  effects: { checked: false },
  prompt: { checked: false },
  runtime: { loaded: false },
  orchestrator: { checked: false },
}

const root = process.env.DAOGANG_DSH_ROOT
if (root && !process.execArgv.includes('--experimental-transform-types')) {
  const child = spawnSync(process.execPath, ['--experimental-transform-types', ...process.execArgv, process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(child.status ?? 1)
}

if (!root) {
  report.effects = { checked: false, reason: 'DAOGANG_DSH_ROOT unset' }
  report.orchestrator = { checked: false, reason: 'DAOGANG_DSH_ROOT unset' }
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

function fail(section, error) {
  try { store?.close() } catch { /* 退出前先放开临时库。 */ }
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = undefined
  store = undefined
  report[section].failed = brief(error)
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

let store
let directory
try {
  if (!existsSync(join(root, 'package.json'))) {
    throw new Error('DAOGANG_DSH_ROOT 没有 package.json')
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-superagent') {
    throw new Error(`package name is ${manifest.name || 'empty'}, expected dsh-superagent`)
  }
  if (!existsSync(join(root, 'node_modules', 'zod'))) {
    throw new Error('clone node_modules is missing zod; run pnpm install in the clone first')
  }
  let commit = ''
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    commit = ''
  }
  report.effects.commit = commit

  const storeMod = await import(pathToFileURL(join(root, 'src/app/store.ts')).href)
  const effectsMod = await import(pathToFileURL(join(root, 'src/app/effects.ts')).href)
  const healthMod = await import(pathToFileURL(join(root, 'src/infra/health.ts')).href)
  const dshMod = await import(pathToFileURL(join(root, 'src/executor/dsh.ts')).href)
  const policyMod = await import(pathToFileURL(join(root, 'src/policy.ts')).href)

  const ticketId = 'probe00000001'
  const assignmentId = 'asg-probe'
  const summary = 'probe-card'
  const cards = [{ role: 'docs', kind: 'task', summary }]
  const userText = 'probe'
  const trigger = inboxTrigger({
    messageId: 'probe1',
    at: '2026-11-02T00:00:00.000Z',
    text: userText,
    decision: { target: 'worker', urgency: 1, cards },
    lane: 'task',
  })
  if (!trigger.text.includes(summary) || !trigger.text.includes(CARD_MARK)) {
    throw new Error('inbox trigger text does not include the card block')
  }
  if (trigger.meta.cards[0]?.summary !== summary) {
    throw new Error('inbox trigger meta.cards dropped the card')
  }

  directory = mkdtempSync(join(tmpdir(), 'daogang-effects-'))
  store = new storeMod.Store(join(directory, 'orchestrator.sqlite'))
  const board = new healthMod.HealthBoard()
  const effects = new effectsMod.Effects(store, board)
  const calls = []
  const host = {
    context: {
      agents: { get() { calls.push('agents.get'); return undefined } },
    },
    engine: {},
    store,
    effects,
    health: board.claim('worker'),
    machine: { stateDir: directory },
    lifetime: new AbortController().signal,
    sessions: {
      ensure() { calls.push('ensure'); throw new Error('sessions.ensure was called') },
      prompt() { calls.push('prompt'); throw new Error('sessions.prompt was called') },
      promptedId(id) { return id },
      relay() { calls.push('relay') },
      holds() { calls.push('holds'); return false },
    },
    closing() { return false },
    paused() { return false },
    environment() { return [] },
    async sourceLink() { calls.push('sourceLink'); return {} },
    repliedTo() { return undefined },
  }
  const executor = new dshMod.DshExecutor(host)
  executor.start({ id: ticketId }, { id: assignmentId })
  executor.deliver({ id: ticketId }, { id: ticketId })
  await new Promise((resolve) => setTimeout(resolve, 20))

  const rows = store.db.prepare('SELECT kind, key, value, attempts FROM effect ORDER BY seq').all().map((row) => ({
    kind: String(row.kind),
    key: String(row.key),
    payload: JSON.parse(String(row.value)),
    attempts: Number(row.attempts),
  }))
  const launch = rows.find((row) => row.kind === 'launch')
  const delivery = rows.find((row) => row.kind === 'delivery')
  if (!launch || launch.key !== assignmentId || launch.attempts !== 0) {
    throw new Error('launch row missing or already attempted')
  }
  if (launch.payload.ticketId !== ticketId || launch.payload.assignmentId !== assignmentId) {
    throw new Error('launch payload does not match the public start() arguments')
  }
  if (Object.keys(launch.payload).some((key) => key !== 'ticketId' && key !== 'assignmentId')) {
    throw new Error('launch payload carries fields other than ticketId and assignmentId')
  }
  if (!delivery || delivery.key !== ticketId || delivery.attempts !== 0 || delivery.payload.ticketId !== ticketId) {
    throw new Error('delivery row missing or does not match deliver()')
  }
  if (Object.keys(delivery.payload).some((key) => key !== 'ticketId')) {
    throw new Error('delivery payload carries fields other than ticketId')
  }
  const payloadText = JSON.stringify(rows)
  if (payloadText.includes(summary) || payloadText.includes(CARD_MARK)) {
    throw new Error('effect payload unexpectedly contains card text')
  }
  if (!effects.pending('launch', assignmentId) || !effects.pending('delivery', ticketId)) {
    throw new Error('queued effects are not pending; start() may have run the handlers')
  }
  if (calls.length !== 0) {
    throw new Error(`worker session path was touched: ${calls.join(',')}`)
  }
  if (dshMod.workerSessionId(ticketId) !== `worker-${ticketId}`) {
    throw new Error('workerSessionId is not worker-<ticketId>')
  }

  store.triggers.save(trigger)
  const stored = store.triggers.get(trigger.id)
  if (stored?.meta?.cards?.[0]?.summary !== summary) {
    throw new Error('stored trigger dropped meta.cards')
  }

  report.effects = {
    checked: true,
    commit,
    effectsStarted: false,
    pendingLaunch: true,
    pendingDelivery: true,
    sessionCalls: calls,
    rows: rows.map((row) => ({ kind: row.kind, key: row.key, payload: row.payload, attempts: row.attempts })),
    cardsInEffectPayload: false,
  }

  const message = dshMod.triggerMessage(trigger, {})
  const settings = policyMod.SettingsSchema.parse({})
  const execution = dshMod.ticketExecution({
    id: ticketId,
    mandate: {
      strength: 'explicit',
      basis: { via: 'addressed', addressed: 'direct' },
    },
    origin: { triggerId: trigger.id, triggerIds: [trigger.id] },
  }, {
    kind: 'accept',
    title: 'probe',
    scope: 'docs',
    reason: 'direct',
    name: 'probe-note',
    note: cardBlock(cards),
  }, settings, directory)
  const followUp = textWithCards('probe', cards)
  const delivered = dshMod.inputMessage({ id: 'in-probe', kind: 'text', text: followUp, at: trigger.at })
  if (typeof message?.text !== 'string' || !message.text.includes(summary)) {
    throw new Error('triggerMessage dropped the card text')
  }
  if (message.chars !== undefined) {
    throw new Error('trigger text was truncated; the probe line should stay within the inline cap')
  }
  if (typeof execution?.assignment !== 'string' || !execution.assignment.includes(summary)) {
    throw new Error('ticketExecution assignment dropped the card note')
  }
  if (delivered !== followUp || !String(delivered).includes(summary)) {
    throw new Error('inputMessage did not keep the text input that carries the cards')
  }
  report.prompt = {
    checked: true,
    triggerInline: true,
    assignmentNote: true,
    deliveryText: true,
    mark: CARD_MARK,
  }
} catch (error) {
  fail(report.effects.checked ? 'prompt' : 'effects', error)
} finally {
  try { store?.close() } catch { /* 临时库关掉失败不影响下面的断言结果。 */ }
  if (directory) rmSync(directory, { recursive: true, force: true })
}

try {
  await import(pathToFileURL(join(root, 'src/app/runtime.ts')).href)
  report.runtime = {
    loaded: true,
    constructed: false,
    reason: '模块能加载。本脚本不构造 Runtime。空 GitHub 配置下的 setupPending，以及 Effects.start() 走到 stub sessions.prompt，见 scripts/check-runtime.mjs。',
  }
} catch (error) {
  const message = brief(error)
  const syntax = error instanceof SyntaxError || /await using|Unexpected identifier/.test(message)
  report.runtime = {
    loaded: false,
    constructed: false,
    reason: syntax
      ? '本机 Node 解析不了 delivery.ts 里的 await using，没有构造 Runtime。写 effect 表不需要 Runtime。'
      : message,
  }
}

try {
  if (!existsSync(join(root, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'))) {
    throw new Error('clone node_modules is missing @deepseek-ai/cordis; run pnpm install in the clone first')
  }
  const { Context } = await import(pathToFileURL(join(root, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')).href)
  const inbox = await import(new URL('../packages/inbox-source/src/index.ts', import.meta.url).href)
  const patch = readFileSync(new URL('../packages/inbox-source/cordis.patch.yml', import.meta.url), 'utf8')
  if (!patch.includes('disabled: true')) throw new Error('cordis.patch.yml no longer keeps disabled: true')

  const pending = await runPlugin(Context, inbox, false)
  const opened = await runPlugin(Context, inbox, true)
  if (pending.received.length !== 0) throw new Error('receive ran while configured() was false')
  if (pending.reports[0]?.code !== 'setupPending') throw new Error('configured() false did not report setupPending')
  if (opened.received.length !== 1) throw new Error('configured() true did not receive the probe trigger')
  const got = opened.received[0]
  if (got?.meta?.cards?.[0]?.summary !== 'probe-card' || !String(got.text).includes(CARD_MARK)) {
    throw new Error('orchestrator receive dropped the card block')
  }
  if (opened.reports.at(-1)?.state !== 'ready') throw new Error('configured() true did not report ready')
  report.orchestrator = {
    checked: true,
    via: 'cordis-context-plugin',
    patchDisabled: true,
    setupPending: true,
    receivedWhenPending: false,
    receivedWhenConfigured: true,
    cardsOnTrigger: true,
    runtimeConstructed: false,
  }
} catch (error) {
  fail('orchestrator', error)
}

console.log(JSON.stringify(report, null, 2))

async function runPlugin(Context, inbox, configured) {
  const received = []
  const reports = []
  const feed = new inbox.InboxFeed()
  const ctx = new Context()
  const child = ctx.extend({ inboxFeed: feed })
  let disposed = false
  child.provide('orchestrator', {
    sources: {
      register() {
        return () => { disposed = true }
      },
    },
    context() {
      return {
        ready: Promise.resolve(),
        configured: () => configured,
        config: () => ({ conversation: 'cli' }),
        receive(trigger) {
          received.push(trigger)
          return { status: 'accepted' }
        },
        report(_entry, health) { reports.push(health) },
      }
    },
  })
  const plugin = { name: inbox.name, inject: [...inbox.inject], apply: inbox.apply }
  await child.plugin(plugin)
  const built = inbox.inboxTrigger({
    messageId: 'probe1',
    at: '2026-11-02T00:00:00.000Z',
    text: 'probe',
    decision: { target: 'worker', urgency: 1, cards: [{ role: 'docs', kind: 'task', summary: 'probe-card' }] },
    lane: 'task',
  })
  feed.push(built)
  await new Promise((resolve) => setTimeout(resolve, 30))
  await ctx.registry.delete(plugin)
  if (!disposed) throw new Error('register() disposer did not run')
  return { received, reports }
}
