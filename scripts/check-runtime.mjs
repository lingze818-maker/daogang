#!/usr/bin/env node
/**
 * 无密钥检查两件事：
 *
 *   node scripts/check-runtime.mjs
 *   DAOGANG_DSH_ROOT=/path/to/dsh-superagent-prototype node scripts/check-runtime.mjs
 *
 * 设了根目录、且该克隆已经 pnpm install 时：
 * - 动态加载克隆里的 Runtime。能解析 `await using` 的 Node（本轮是 24）会构造它。
 *   空 GitHub 配置下应停在 setupPending，并且不调用 effects.start() / sessions.ensure。
 *   webServer 只是 host 为 127.0.0.1 的登记桩，不监听端口。
 * - 用公开的 Store 写下最小票、pending Assignment 和已存在的 workspace，
 *   再调用 Effects.start()。handler 进入私有 launch() 后，stub sessions.prompt
 *   记下首条消息。断言正文仍含 [daogang-cards]。不 import Engine，不调用模型。
 *
 * 没设根目录时只说明跳过，退出 0。pnpm test 不跑这一段。
 * 打印的结果不含绝对路径。当前 Node 解析不了 await using 时，Runtime 一段失败并退出非 0；
 * launch 一段仍会尝试（它不加载 delivery.ts）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CARD_MARK, cardBlock, inboxTrigger } from '../packages/inbox-source/src/index.ts'

function brief(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\/[\w.+@~-]+(?:\/[\w.+@~-]+)+/g, '<path>').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function parsesAwaitUsing() {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'await using resource = { async [Symbol.asyncDispose]() {} }'], {
    encoding: 'utf8',
  })
  return child.status === 0
}

const report = {
  node: process.version,
  runtime: { loaded: false, constructed: false },
  launch: { checked: false },
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
  report.runtime = { loaded: false, constructed: false, reason: 'DAOGANG_DSH_ROOT unset' }
  report.launch = { checked: false, reason: 'DAOGANG_DSH_ROOT unset' }
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

function load(rel) {
  return import(pathToFileURL(join(root, rel)).href)
}

let commit = ''
try {
  if (!existsSync(join(root, 'package.json'))) throw new Error('DAOGANG_DSH_ROOT 没有 package.json')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-superagent') {
    throw new Error(`package name is ${manifest.name || 'empty'}, expected dsh-superagent`)
  }
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    commit = ''
  }
  report.commit = commit
  report.awaitUsing = parsesAwaitUsing()

  if (!report.awaitUsing) {
    report.runtime = {
      loaded: false,
      constructed: false,
      effectsStarted: false,
      sessionsEnsure: false,
      reason: '当前 Node 解析不了 await using，没有 import Runtime。上游 delivery.ts 使用这条语法。Node 24 可以解析；Node 22.23 的 ESM 解析器即使加上 --js-explicit-resource-management 也会 SyntaxError。',
    }
  } else {
    report.runtime = await probeRuntime()
  }
} catch (error) {
  report.runtime = {
    ...report.runtime,
    loaded: report.runtime.loaded === true,
    constructed: false,
    failed: brief(error),
  }
}

try {
  report.launch = await probeLaunch()
} catch (error) {
  report.launch = { ...report.launch, checked: false, failed: brief(error) }
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.runtime.constructed === true && report.runtime.effectsStarted === false && report.launch.checked === true ? 0 : 1)

async function probeRuntime() {
  const runtimeMod = await load('src/app/runtime.ts')
  const effectsMod = await load('src/app/effects.ts')
  const sessionsMod = await load('src/app/sessions.ts')
  const cordis = await load('node_modules/@deepseek-ai/cordis/lib/index.js')
  if (typeof runtimeMod.Runtime !== 'function') throw new Error('Runtime 没有导出')

  let effectsStarted = 0
  let ensures = 0
  const origStart = effectsMod.Effects.prototype.start
  const origEnsure = sessionsMod.Sessions.prototype.ensure
  effectsMod.Effects.prototype.start = function started(...args) {
    effectsStarted += 1
    return origStart.apply(this, args)
  }
  sessionsMod.Sessions.prototype.ensure = function ensured(...args) {
    ensures += 1
    return origEnsure.apply(this, args)
  }

  const directory = mkdtempSync(join(tmpdir(), 'daogang-runtime-'))
  let runtime
  let stopError
  let observed
  report.runtime = { loaded: true, constructed: false }
  try {
    const ctx = new cordis.Context()
    ctx.provide('webServer', {
      host: '127.0.0.1',
      port: 9,
      register() { return () => {} },
    })
    ctx.provide('agents', { get() { return undefined } })
    ctx.provide('sessionPersistence', { async flush() {} })
    const machine = {
      stateDir: directory,
      promptMaxChars: { get: () => 100_000 },
      admissionContextMaxPages: { get: () => 10 },
      admissionContextTimeoutMs: { get: () => 15_000 },
    }
    runtime = new runtimeMod.Runtime(ctx, machine, () => {})
    await runtime.ready
    const entry = runtime.health?.runtime
    if (runtime.configured() !== false) throw new Error('empty GitHub config left Runtime configured')
    if (runtime.setupProblem?.code !== 'repositoryUnset') {
      throw new Error(`setup problem is ${runtime.setupProblem?.code ?? 'empty'}, expected repositoryUnset`)
    }
    if (entry?.state !== 'paused' || entry?.code !== 'setupPending') {
      throw new Error(`runtime health is ${entry?.state ?? 'empty'}/${entry?.code ?? 'empty'}, expected paused/setupPending`)
    }
    if (effectsStarted !== 0) throw new Error('effects.start() ran while setup was pending')
    if (ensures !== 0) throw new Error('sessions.ensure() ran while setup was pending')
    observed = {
      loaded: true,
      constructed: true,
      commit,
      configured: false,
      setupProblem: 'repositoryUnset',
      healthState: 'paused',
      healthCode: 'setupPending',
      effectsStarted: false,
      sessionsEnsure: false,
      webServer: 'loopback-stub',
      listened: false,
    }
  } finally {
    effectsMod.Effects.prototype.start = origStart
    sessionsMod.Sessions.prototype.ensure = origEnsure
    try { await runtime?.stop() } catch (error) { stopError = error }
    rmSync(directory, { recursive: true, force: true })
  }
  if (stopError) throw stopError
  return observed
}

async function probeLaunch() {
  const storeMod = await load('src/app/store.ts')
  const effectsMod = await load('src/app/effects.ts')
  const healthMod = await load('src/infra/health.ts')
  const dshMod = await load('src/executor/dsh.ts')

  const directory = mkdtempSync(join(tmpdir(), 'daogang-launch-'))
  let store
  try {
    const ticketId = 'probe00000001'
    const assignmentId = 'asg-probe'
    const summary = 'probe-card'
    const cards = [{ role: 'docs', kind: 'task', summary }]
    const trigger = inboxTrigger({
      messageId: 'probe1',
      at: '2026-11-02T00:00:00.000Z',
      text: 'probe',
      decision: { target: 'worker', urgency: 1, cards },
      lane: 'task',
    })
    store = new storeMod.Store(join(directory, 'orchestrator.sqlite'))
    store.triggers.save(trigger)
    const settings = store.settings()
    const draft = {
      id: ticketId,
      title: 'probe',
      decisionId: 'dec-probe',
      mandate: {
        strength: 'explicit',
        policyVersion: '',
        basis: { via: 'addressed', addressed: 'direct' },
        actor: { source: 'inbox', id: 'cli-user' },
        scope: 'docs',
      },
      channels: [trigger.channel],
      assignments: [{ id: assignmentId, state: 'pending', createdAt: trigger.at }],
      inputs: [],
      undelivered: [],
      createdAt: trigger.at,
      updatedAt: trigger.at,
      origin: { triggerId: trigger.id, triggerIds: [trigger.id] },
    }
    const execution = dshMod.ticketExecution(draft, {
      kind: 'accept',
      title: 'probe',
      scope: 'docs',
      reason: 'direct',
      name: 'probe-note',
      note: cardBlock(cards),
    }, settings, directory)
    mkdirSync(execution.directory, { recursive: true })
    store.tickets.save({ ...draft, execution })

    const seen = []
    let environmentCalls = 0
    const board = new healthMod.HealthBoard()
    const effects = new effectsMod.Effects(store, board)
    const host = {
      context: { agents: { get() { return undefined } } },
      engine: {
        assignmentStarted() { seen.push('assignmentStarted') },
        inputsDelivered() { seen.push('inputsDelivered') },
        inputsRead() { seen.push('inputsRead') },
        turnEnded() { seen.push('turnEnded') },
        deliveryFailed() { seen.push('deliveryFailed') },
        report() { seen.push('report') },
        assignmentInterrupted() { seen.push('assignmentInterrupted') },
      },
      store,
      effects,
      health: board.claim('worker'),
      machine: { stateDir: directory },
      lifetime: new AbortController().signal,
      sessions: {
        async ensure(id, _cwd, title, role) {
          seen.push({ op: 'ensure', id, role, title })
          return { inbox: { remove() { seen.push('inbox.remove') } } }
        },
        async prompt(sessionId, requestId, text, mode, authorize, accepted) {
          authorize?.()
          seen.push({ op: 'prompt', sessionId, requestId, mode, text })
          accepted?.()
        },
        promptedId(id) { return id },
        relay() { seen.push('relay') },
        async holds() { seen.push('holds'); return false },
      },
      closing() { return false },
      paused() { return false },
      environment() { environmentCalls += 1; return [] },
      async sourceLink() { seen.push('sourceLink'); return {} },
      repliedTo() { return undefined },
    }
    const executor = new dshMod.DshExecutor(host)
    executor.start({ id: ticketId }, { id: assignmentId })
    const queued = store.db.prepare('SELECT kind, key, value, attempts FROM effect WHERE kind = ?').get('launch')
    const payload = queued ? JSON.parse(String(queued.value)) : undefined
    if (!queued || String(queued.key) !== assignmentId || Number(queued.attempts) !== 0) {
      throw new Error('launch row was missing before Effects.start()')
    }
    if (payload.ticketId !== ticketId || payload.assignmentId !== assignmentId) {
      throw new Error('launch payload does not match the public start() arguments')
    }
    if (Object.keys(payload).some((key) => key !== 'ticketId' && key !== 'assignmentId')) {
      throw new Error('launch payload carries fields other than ticketId and assignmentId')
    }
    effects.start()
    await effects.idle('launch')
    const left = store.db.prepare('SELECT attempts, error FROM effect WHERE kind = ? AND key = ?').get('launch', assignmentId)
    if (left) throw new Error(`launch row remained after the handler: attempts=${left.attempts} ${String(left.error).slice(0, 120)}`)
    if (environmentCalls !== 0) throw new Error('launch prepared a workspace; the fixture directory should already exist')

    const ensured = seen.find((item) => item && item.op === 'ensure')
    const prompted = seen.find((item) => item && item.op === 'prompt')
    const sessionId = dshMod.workerSessionId(ticketId)
    if (!ensured || ensured.id !== sessionId || ensured.role !== 'worker') {
      throw new Error('sessions.ensure did not open worker-<ticketId>')
    }
    if (!prompted || prompted.sessionId !== sessionId || prompted.mode !== 'queue' || prompted.requestId !== `assignment:${ticketId}`) {
      throw new Error('sessions.prompt was not the first worker message')
    }
    const body = JSON.parse(String(prompted.text))
    const assignment = String(body.assignment ?? '')
    const triggerText = String(body.trigger?.text ?? '')
    if (!assignment.includes(CARD_MARK) || !assignment.includes(summary)) {
      throw new Error('prompt assignment dropped the card note')
    }
    if (!triggerText.includes(CARD_MARK) || !triggerText.includes(summary)) {
      throw new Error('prompt trigger text dropped the card block')
    }
    const started = seen.filter((item) => item === 'assignmentStarted').length
    if (started < 1) throw new Error('launch returned without assignmentStarted')
    return {
      checked: true,
      commit,
      effectsStarted: true,
      handlerReached: true,
      sessionId,
      ensureRole: 'worker',
      promptMode: 'queue',
      requestId: `assignment:${ticketId}`,
      mark: CARD_MARK,
      cardsInAssignment: true,
      cardsInTriggerText: true,
      effectConsumed: true,
      assignmentStarted: started,
      modelCalled: false,
      engineImported: false,
      fixture: { text: 'probe', summary },
    }
  } finally {
    try { store?.close() } catch { /* 临时库关掉失败不影响上面的断言。 */ }
    rmSync(directory, { recursive: true, force: true })
  }
}
