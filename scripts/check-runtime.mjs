#!/usr/bin/env node
/**
 * 无密钥检查三件事：
 *
 *   node scripts/check-runtime.mjs
 *   DAOGANG_DSH_ROOT=/path/to/dsh-superagent-prototype node scripts/check-runtime.mjs
 *
 * 设了根目录、且该克隆已经 pnpm install 时：
 * - 动态加载克隆里的 Runtime。能解析 `await using` 的 Node（24+）会构造它。
 *   空 GitHub 配置下应停在 setupPending，并且不调用 effects.start() / sessions.ensure。
 *   webServer 只是 host 为 127.0.0.1 的登记桩，不监听端口。
 * - 同一套 Runtime，在临时库写入 repository `probe/probe` 和一个不会被执行的 probe-cli。
 *   subprocess.spawn 是夹具，只回答 api user、repos/probe/probe 和 git credential helper。
 *   不读 API key，不调用 gh。configured() 为 true 之后，应调用 effects.start()，
 *   并用 stub 挡住的 sessions.ensure 记下一次主会话（role orchestrator）。
 *   不提供 sessionController，不调用 AgentDelivery.send，不监听端口。
 * - 上述 configured 成功并且 effects.start 之后，再试公开的 sessionController / Session。
 *   原来的 Sessions.ensure 会在 resolveAgent 前失败，因为上下文里没有 sessionController。
 *   另开 Cordis Context，只挂克隆里能解析的公开插件。SessionController 因 inject 停在未激活时，
 *   JSON 写 blockedAt、condition、missingHooks，这是文档化硬挡，退出码仍是 0。
 *   同一 masterId、state 目录和公开 ROUTER_PRESET 上，SessionStore.create 得到 Session。
 *   不调用 prompt / rename / llm，不调用 gh，不 listen。
 *   若 SessionController 真的激活，则改走它的 create，并断言句柄。
 * - 用公开的 Store 写下最小票、pending Assignment 和已存在的 workspace，
 *   再调用 Effects.start()。handler 进入私有 launch() 后，stub sessions.prompt
 *   记下首条消息。断言正文仍含 [daogang-cards]。不 import Engine，不调用模型。
 *
 * 没设根目录时只说明跳过，退出 0。pnpm test 不跑这一段。
 * 打印的结果不含绝对路径。当前 Node 解析不了 await using 时，Runtime、configured
 * 与 session 三段失败并退出非 0；launch 一段仍会尝试（它不加载 delivery.ts）。
 * configured() 没到 true 时，JSON 的 configured.blockedAt / condition 写出函数和条件，退出非 0。
 * session 段的退出码：文档化硬挡（blockedAt / condition / missingHooks，且 SessionStore
 * 得到可识别的 Session）是 0；SessionController 激活后 create 得到句柄也是 0。两种都要求
 * 没有模型请求、没有 gh、没有 listen。意外抛错是非 0。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  configured: { passed: false },
  launch: { checked: false },
  session: { passed: false },
}

const AWAIT_USING = '当前 Node 解析不了 await using，没有 import Runtime。上游 delivery.ts 使用这条语法。Node 24 可以解析；Node 22.23 的 ESM 解析器即使加上 --js-explicit-resource-management 也会 SyntaxError。'

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
  report.configured = { passed: false, reason: 'DAOGANG_DSH_ROOT unset' }
  report.launch = { checked: false, reason: 'DAOGANG_DSH_ROOT unset' }
  report.session = { passed: false, reason: 'DAOGANG_DSH_ROOT unset' }
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
      reason: AWAIT_USING,
    }
    report.configured = { passed: false, reason: AWAIT_USING }
    report.session = { passed: false, reason: AWAIT_USING }
  }
} catch (error) {
  report.runtime = {
    ...report.runtime,
    loaded: report.runtime.loaded === true,
    constructed: false,
    failed: brief(error),
  }
  report.configured = { passed: false, failed: brief(error) }
  report.session = { passed: false, failed: brief(error) }
}

if (report.awaitUsing) {
  try {
    report.runtime = await probeRuntime()
  } catch (error) {
    report.runtime = {
      ...report.runtime,
      loaded: report.runtime.loaded === true,
      constructed: false,
      failed: brief(error),
    }
  }
  try {
    report.configured = await probeConfigured()
  } catch (error) {
    report.configured = { ...report.configured, passed: false, failed: brief(error) }
    if (report.session.passed !== true && !report.session.reason && !report.session.failed && !report.session.outcome) {
      report.session = { passed: false, failed: brief(error) }
    }
  }
}

try {
  report.launch = await probeLaunch()
} catch (error) {
  report.launch = { ...report.launch, checked: false, failed: brief(error) }
}

console.log(JSON.stringify(report, null, 2))
const runtimeOk = report.runtime.constructed === true && report.runtime.configured === false && report.runtime.effectsStarted === false
const configuredOk = report.configured.passed === true && report.configured.configured === true && report.configured.effectsStarted === true && report.configured.masterEnsure === true && report.configured.agentDeliverySend === false
const sessionOk = report.session.passed === true && report.session.modelCalled === false && report.session.ghInvoked === false && report.session.listened === false && report.session.fetchCalled === false
process.exit(runtimeOk && configuredOk && report.launch.checked === true && sessionOk ? 0 : 1)

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

const SETUP_BLOCKS = {
  repositoryUnset: ['resolveDeployment', 'if (!remote) throw new SetupError(\'repositoryUnset\')'],
  agentCliUnset: ['resolveDeployment', 'if (!accounts.cli) throw new SetupError(\'agentCliUnset\')'],
  agentCliMissing: ['resolveDeployment', 'executable() threw SetupError(\'agentCliMissing\')'],
  agentCliSignedOut: ['resolveDeployment', 'probe([cli, \'api\', \'user\']) threw SetupError(\'agentCliSignedOut\')'],
  agentCliNoAccount: ['resolveDeployment', 'parsed(GithubUser, text) failed'],
  repositoryUnreadable: ['resolveDeployment', 'probe(repos/<repository>) threw SetupError(\'repositoryUnreadable\')'],
  repositoryUnreported: ['resolveDeployment', 'parsed(RepositoryAccess, text) failed'],
  repositoryReadOnly: ['resolveDeployment', 'access.push !== true'],
  foreignFile: ['writeEnvironment', 'a file in worker-bin or worker-gitconfig was not written by dsh-superagent'],
  gitTooOld: ['verifyEnvironment', 'git credential helper stdout !== file:<worker-gitconfig> + credentialHelper(cli)'],
  environmentFailed: ['Setup.resolve', 'writeEnvironment or verifyEnvironment threw SetupError(\'environmentFailed\')'],
  feishuCliFailed: ['resolveFeishuBot', 'the feishu cli probe failed; this fixture leaves feishu cli empty so this branch should not run'],
}

function shellQuote(value) {
  return `'${String(value).replaceAll('\'', '\'\\\'\'')}'`
}

function snapshotEnv() {
  return { ...process.env }
}

function restoreEnv(saved) {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  for (const [key, value] of Object.entries(saved)) process.env[key] = value
}

async function probeConfigured() {
  const runtimeMod = await load('src/app/runtime.ts')
  const storeMod = await load('src/app/store.ts')
  const effectsMod = await load('src/app/effects.ts')
  const sessionsMod = await load('src/app/sessions.ts')
  const deliveryMod = await load('src/app/delivery.ts')
  const envMod = await load('src/infra/environment.ts')
  const cordis = await load('node_modules/@deepseek-ai/cordis/lib/index.js')
  const patch = readFileSync(new URL('../packages/inbox-source/cordis.patch.yml', import.meta.url), 'utf8')
  if (!patch.includes('disabled: true')) throw new Error('cordis.patch.yml no longer keeps disabled: true')
  if (typeof runtimeMod.Runtime !== 'function') throw new Error('Runtime 没有导出')

  const directory = mkdtempSync(join(tmpdir(), 'daogang-configured-'))
  const cli = join(directory, 'probe-cli')
  const marker = join(directory, 'probe-cli-executed')
  const repository = 'probe/probe'
  const login = 'probe'
  writeFileSync(cli, `#!/bin/sh\nprintf '%s\\n' executed > ${shellQuote(marker)}\nexit 97\n`, { mode: 0o755 })
  chmodSync(cli, 0o755)
  let seeded
  try {
    seeded = new storeMod.Store(join(directory, 'orchestrator.sqlite'))
    seeded.saveSettings({
      sources: { github: { enabled: true, config: { repository, cli } } },
    })
  } finally {
    try { seeded?.close() } catch { /* 种子库关掉后再让 Runtime 拿目录锁。 */ }
  }

  const calls = []
  const userArgv = `${cli} api user`
  const repoArgv = `${cli} api repos/${repository} --jq {name: .full_name, push: .permissions.push}`
  const gitArgv = 'git config -z --show-origin --get-all credential.https://github.com.helper'
  const gitStdout = `file:${envMod.workerGitConfig(directory)}\0${envMod.credentialHelper(cli)}\0`
  const subprocess = {
    spawn(spec) {
      const rest = [...spec.argv]
      while (rest[0] === 'env' || /^[A-Z_]+=/.test(rest[0] ?? '')) rest.shift()
      const key = rest.join(' ')
      calls.push(rest.map((part, index) => (index === 0 ? String(part).split(/[\\/]/).at(-1) : part)))
      const answer = key === userArgv ? '{"login":"probe","id":1}\n'
        : key === repoArgv ? '{"name":"probe/probe","push":true}\n'
          : key === gitArgv ? gitStdout : undefined
      const reader = (text) => ({ readFrom: () => ({ text }) })
      return {
        done: Promise.resolve({ exitCode: answer === undefined ? 1 : 0, signal: null }),
        collected: {
          stdout: reader(answer ?? ''),
          stderr: reader(answer === undefined ? 'fixture refuses' : ''),
        },
      }
    },
  }

  let effectsStarted = 0
  let sends = 0
  const ensures = []
  const origStart = effectsMod.Effects.prototype.start
  const origEnsure = sessionsMod.Sessions.prototype.ensure
  const origPrompt = sessionsMod.Sessions.prototype.prompt
  const origSend = deliveryMod.AgentDelivery.prototype.send
  effectsMod.Effects.prototype.start = function started(...args) {
    effectsStarted += 1
    return origStart.apply(this, args)
  }
  sessionsMod.Sessions.prototype.ensure = async function ensured(id, cwd, title, role) {
    ensures.push({ id, title, role, cwdIsState: cwd === directory })
    return { id, inbox: { remove() {} } }
  }
  sessionsMod.Sessions.prototype.prompt = async function prompted() {
    throw new Error('sessions.prompt was called on the configured Runtime')
  }
  deliveryMod.AgentDelivery.prototype.send = function sent() {
    sends += 1
    throw new Error('AgentDelivery.send was called')
  }

  let runtime
  let stopError
  let outcome
  let listened = false
  const envBefore = snapshotEnv()
  try {
    const ctx = new cordis.Context()
    ctx.provide('webServer', {
      host: '127.0.0.1',
      port: 9,
      register() { return () => {} },
      listen() { listened = true; throw new Error('webServer.listen was called') },
    })
    ctx.provide('agents', { get() { return undefined } })
    ctx.provide('sessionPersistence', { async flush() {} })
    ctx.provide('subprocess', subprocess)
    runtime = new runtimeMod.Runtime(ctx, {
      stateDir: directory,
      promptMaxChars: { get: () => 100_000 },
      admissionContextMaxPages: { get: () => 10 },
      admissionContextTimeoutMs: { get: () => 15_000 },
    }, () => {})
    await runtime.ready
    await runtime.effects.idle()
    if (existsSync(marker)) throw new Error('probe-cli was executed')
    if (listened) throw new Error('webServer.listen was called')
    const ghInvoked = calls.some((argv) => argv[0] === 'gh' || argv[0] === 'lark-cli')
    if (ghInvoked) throw new Error('fixture subprocess invoked gh or lark-cli')
    const entry = runtime.health?.runtime
    if (runtime.configured() !== true) {
      const code = runtime.setupProblem?.code ?? 'missing'
      const [blockedAt, condition] = SETUP_BLOCKS[code] ?? ['Setup.run', `setupProblem.code is ${code}`]
      outcome = {
        passed: false,
        commit,
        configured: false,
        blockedAt,
        condition,
        setupProblem: code,
        effectsStartCount: effectsStarted,
        ensureCount: ensures.length,
        ghInvoked: false,
        fixtureCliExecuted: false,
        commands: calls,
        webServer: 'loopback-stub',
        listened: false,
      }
      report.session = { passed: false, reason: 'configured() is false' }
    } else {
      const ensured = ensures[0]
      if (effectsStarted !== 1) throw new Error(`effects.start() count is ${effectsStarted}, expected 1`)
      if (ensures.length !== 1 || ensured.role !== 'orchestrator' || ensured.title !== 'dsh-superagent orchestrator') {
        throw new Error('sessions.ensure did not open the orchestrator session once')
      }
      if (ensured.id !== runtime.masterId || !String(ensured.id).startsWith('orchestrator-') || ensured.cwdIsState !== true) {
        throw new Error('sessions.ensure did not receive the master session id and state directory')
      }
      if (sends !== 0) throw new Error('AgentDelivery.send ran')
      if (entry?.state !== 'ready') throw new Error(`runtime health is ${entry?.state ?? 'empty'}, expected ready`)
      if (runtime.setupProblem) throw new Error(`setup problem remained: ${runtime.setupProblem.code}`)
      if (runtime.deployment.repository !== repository || runtime.deployment.github.login !== login) {
        throw new Error('resolved deployment is not the probe repository')
      }
      if (runtime.deployment.feishu) throw new Error('resolveFeishuBot returned a bot')
      const expectedCalls = [
        ['probe-cli', 'api', 'user'],
        ['probe-cli', 'api', 'repos/probe/probe', '--jq', '{name: .full_name, push: .permissions.push}'],
        ['git', 'config', '-z', '--show-origin', '--get-all', 'credential.https://github.com.helper'],
      ]
      if (JSON.stringify(calls) !== JSON.stringify(expectedCalls)) {
        throw new Error(`subprocess fixture saw unexpected argv: ${JSON.stringify(calls)}`)
      }
      try {
        report.session = await probeMasterSession({
          runtime,
          directory,
          commit,
          routerPreset: sessionsMod.ROUTER_PRESET,
          origEnsure,
          calls,
          sendCount: () => sends,
          listened: () => listened,
          effectsStarted,
        })
      } catch (error) {
        report.session = { passed: false, failed: brief(error), modelCalled: false, ghInvoked: false, listened: false, fetchCalled: false }
      }
      outcome = {
        passed: true,
        commit,
        configured: true,
        repository,
        login,
        via: 'settings.sources.github + fixture subprocess',
        resolveDeployment: 'fixture-stdout',
        resolveFeishuBot: 'cli-empty',
        verifyEnvironment: 'fixture-stdout',
        ghInvoked: false,
        fixtureCliExecuted: false,
        setupProblem: null,
        healthState: 'ready',
        effectsStarted: true,
        effectsStartCount: effectsStarted,
        masterEnsure: true,
        ensureCount: ensures.length,
        ensureRole: ensured.role,
        ensureTitle: ensured.title,
        idMatchesMaster: true,
        cwdIsStateDir: true,
        sessionControllerProvided: false,
        agentDeliverySend: false,
        modelCalled: false,
        commands: calls,
        webServer: 'loopback-stub',
        listened: false,
        patchDisabled: true,
      }
    }
  } catch (error) {
    outcome = error
  } finally {
    effectsMod.Effects.prototype.start = origStart
    sessionsMod.Sessions.prototype.ensure = origEnsure
    sessionsMod.Sessions.prototype.prompt = origPrompt
    deliveryMod.AgentDelivery.prototype.send = origSend
    try { await runtime?.stop() } catch (error) { stopError = error }
    restoreEnv(envBefore)
    rmSync(directory, { recursive: true, force: true })
  }
  if (stopError) throw stopError
  if (outcome instanceof Error) throw outcome
  return outcome
}

function packageResolves(name) {
  try {
    createRequire(join(root, 'package.json')).resolve(`${name}/package.json`)
    return true
  } catch {
    return false
  }
}

function hookNote(service, resolvable) {
  if (service === 'llm' && resolvable) return '包能解析。本探测不 compose LlmRuntime，避免进入模型栈。它不是 Session 工厂'
  if (service === 'attachments' && resolvable) return '包能解析，导出的 AttachmentStore 是抽象服务，克隆里没有可激活的具体后端'
  if (service === 'workspaceRegistry' && resolvable) return 'WorkspaceRegistry 已挂上但未激活，还缺 storageDomain 和具体的 sessionPersistence'
  if (service === 'sessionPersistence' && resolvable) return '包能解析，但是抽象服务；jsonl 后端不在这次 pnpm install 里'
  if (!resolvable) return '克隆 pnpm install 之后这个包解析不到'
  return '服务没有出现在上下文里'
}

function pluginState(fiber) {
  if (fiber?.state === 2) return 'active'
  if (fiber?.state === 3) return 'error'
  if (fiber?.state === 4) return 'disposed'
  return 'inactive'
}

async function probeMasterSession({ runtime, directory, commit, routerPreset, origEnsure, calls, sendCount, listened, effectsStarted }) {
  const HOOK_PACKAGES = {
    agentDefaultModel: '@deepseek-ai/dsh-agent-default-model',
    agents: '@deepseek-ai/dsh-agent',
    attachments: '@deepseek-ai/dsh-attachment',
    fileUploads: '@deepseek-ai/dsh-client-file-upload',
    fs: '@deepseek-ai/dsh-fs',
    llm: '@deepseek-ai/dsh-llm',
    sessions: '@deepseek-ai/dsh-session',
    sessionProjections: '@deepseek-ai/dsh-session-projection',
    sessionQuery: '@deepseek-ai/dsh-session-query',
    typert: '@deepseek-ai/dsh-typert-protocol',
    workspaceRegistry: '@deepseek-ai/dsh-workspace',
    storageDomain: '@deepseek-ai/dsh-storage-domain',
    sessionPersistence: '@deepseek-ai/dsh-session-persistence',
    sessionPersistenceJsonl: '@deepseek-ai/dsh-session-persistence-jsonl',
  }
  if (typeof routerPreset !== 'string' || routerPreset.length === 0) throw new Error('ROUTER_PRESET is not exported')
  if (effectsStarted !== 1) throw new Error('session probe ran before effects.start()')
  const callsBefore = calls.length
  const sendsBefore = sendCount()
  const origFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = () => {
    fetches += 1
    throw new Error('fetch during session probe')
  }
  const fibers = []
  const pkg = (name) => import(pathToFileURL(join(root, 'node_modules', name, 'lib/index.js')).href)
  try {
    let ensureThrown = ''
    let ensured
    try {
      ensured = await origEnsure.call(runtime.sessions, runtime.masterId, directory, 'dsh-superagent orchestrator', 'orchestrator')
    } catch (error) {
      ensureThrown = brief(error)
    }
    if (ensured) {
      const id = String(ensured.id ?? ensured.session?.id ?? '')
      if (id !== runtime.masterId) throw new Error('original Sessions.ensure returned a different id')
      if (fetches !== 0 || sendCount() !== sendsBefore) throw new Error('original Sessions.ensure called the model stack')
      return {
        passed: true,
        outcome: 'sessions-ensure',
        commit,
        blockedAt: null,
        condition: null,
        missingHooks: [],
        ensure: { calledOriginal: true, reached: true, role: 'orchestrator', title: 'dsh-superagent orchestrator' },
        sessionController: { activated: true },
        constructed: {
          reached: true,
          via: 'Sessions.ensure',
          ctor: ensured.constructor?.name ?? 'Agent',
          idMatchesMaster: true,
          idPrefix: 'orchestrator-',
          role: 'orchestrator',
          agentPreset: routerPreset,
          title: 'dsh-superagent orchestrator',
          cwdIsStateDir: true,
        },
        modelCalled: false,
        ghInvoked: false,
        agentDeliverySend: false,
        fetchCalled: false,
        webServer: 'loopback-stub',
        listened: listened(),
      }
    }
    if (!/sessionController|resolveAgent|without inject/.test(ensureThrown)) {
      throw new Error(`original Sessions.ensure failed outside sessionController: ${ensureThrown}`)
    }

    const sessionPkg = await pkg('@deepseek-ai/dsh-session')
    const controllerPkg = await pkg('@deepseek-ai/dsh-api-session-controller')
    const agentPkg = await pkg('@deepseek-ai/dsh-agent')
    const workspacePkg = await pkg('@deepseek-ai/dsh-workspace')
    const cordis = await load('node_modules/@deepseek-ai/cordis/lib/index.js')
    const SessionStore = sessionPkg.SessionStore ?? sessionPkg.default
    const SessionController = controllerPkg.SessionController ?? controllerPkg.default
    const AgentRegistry = agentPkg.AgentRegistry
    const WorkspaceRegistry = workspacePkg.WorkspaceRegistry ?? workspacePkg.default
    if (typeof SessionStore !== 'function' || typeof SessionController !== 'function') {
      throw new Error('public SessionStore or SessionController export is missing')
    }
    if (!Array.isArray(SessionController.inject) || SessionController.inject.length === 0) {
      throw new Error('SessionController.inject is not the public service list')
    }

    const side = new cordis.Context()
    const mount = async (plugin, config) => {
      const fiber = await side.plugin(plugin, config)
      fibers.push(fiber)
      return fiber
    }
    const sessionsFiber = await mount(SessionStore)
    const agentsFiber = await mount(AgentRegistry)
    const workspaceFiber = await mount(WorkspaceRegistry)
    const controllerFiber = await mount(SessionController, { listWorkSliceMs: 16 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (pluginState(controllerFiber) === 'error') throw new Error('SessionController plugin entered the error state')
    const controller = side.get('sessionController')
    const activated = pluginState(controllerFiber) === 'active' && controller && typeof controller.create === 'function'
    const activatedServices = [
      pluginState(sessionsFiber) === 'active' && side.get('sessions') ? 'sessions' : null,
      pluginState(agentsFiber) === 'active' && side.get('agents') ? 'agents' : null,
    ].filter(Boolean)
    const inactivePlugins = [
      pluginState(workspaceFiber) !== 'active' ? 'workspaceRegistry' : null,
      !activated ? 'sessionController' : null,
    ].filter(Boolean)

    const missingHooks = []
    for (const service of SessionController.inject) {
      if (side.get(service) !== undefined) continue
      const packageName = HOOK_PACKAGES[service] ?? ''
      const resolvable = packageName ? packageResolves(packageName) : false
      const hook = { service, package: packageName || null, resolvable, note: hookNote(service, resolvable) }
      if (service === 'workspaceRegistry') {
        const persistence = HOOK_PACKAGES.sessionPersistence
        const jsonl = HOOK_PACKAGES.sessionPersistenceJsonl
        hook.missing = [
          { service: 'storageDomain', package: HOOK_PACKAGES.storageDomain, resolvable: packageResolves(HOOK_PACKAGES.storageDomain), note: hookNote('storageDomain', packageResolves(HOOK_PACKAGES.storageDomain)) },
          { service: 'sessionPersistence', package: persistence, resolvable: packageResolves(persistence), note: hookNote('sessionPersistence', packageResolves(persistence)), jsonlResolvable: packageResolves(jsonl) },
        ]
      }
      missingHooks.push(hook)
    }

    const ghInvoked = calls.slice(callsBefore).some((argv) => argv[0] === 'gh' || argv[0] === 'lark-cli')
    if (ghInvoked) throw new Error('session probe invoked gh or lark-cli')
    if (calls.length !== callsBefore) throw new Error('session probe invoked the subprocess fixture')
    if (sendCount() !== sendsBefore) throw new Error('AgentDelivery.send ran during the session probe')
    if (listened()) throw new Error('webServer.listen ran during the session probe')
    if (fetches !== 0) throw new Error('fetch ran during the session probe')

    if (activated) {
      const created = await controller.create({
        sessionId: sessionPkg.SessionId(runtime.masterId),
        cwd: directory,
        agentPreset: routerPreset,
      })
      if (fetches !== 0) throw new Error('sessionController.create called fetch')
      if (calls.length !== callsBefore || calls.slice(callsBefore).some((argv) => argv[0] === 'gh' || argv[0] === 'lark-cli')) {
        throw new Error('sessionController.create invoked gh or the subprocess fixture')
      }
      if (sendCount() !== sendsBefore) throw new Error('AgentDelivery.send ran during sessionController.create')
      if (listened()) throw new Error('webServer.listen ran during sessionController.create')
      if (created?.sessionId !== runtime.masterId) throw new Error('sessionController.create did not return the master id')
      return {
        passed: true,
        outcome: 'session-controller',
        commit,
        blockedAt: null,
        condition: null,
        missingHooks,
        ensure: { calledOriginal: true, reached: false, blockedAt: 'Sessions.ensure', condition: 'runtime context has no sessionController', thrown: ensureThrown },
        sessionController: { activated: true, via: 'sessionController.create' },
        constructed: {
          reached: true,
          via: 'sessionController.create',
          idMatchesMaster: true,
          idPrefix: 'orchestrator-',
          role: 'orchestrator',
          agentPreset: created.agentPreset ?? routerPreset,
          title: null,
          titleHook: 'sessionController.rename',
          cwdIsStateDir: true,
        },
        activatedServices,
        inactivePlugins,
        modelCalled: false,
        ghInvoked: false,
        agentDeliverySend: false,
        fetchCalled: false,
        promptCalled: false,
        webServer: 'loopback-stub',
        listened: false,
      }
    }

    if (missingHooks.length === 0) throw new Error('SessionController stayed inactive without a missing hook')
    if (pluginState(sessionsFiber) !== 'active' || typeof side.get('sessions')?.create !== 'function') {
      throw new Error('public SessionStore did not activate')
    }
    const sessionId = sessionPkg.SessionId(runtime.masterId)
    const session = side.get('sessions').create(sessionId, { meta: { cwd: directory, agentPreset: routerPreset } })
    const header = session?.header ?? {}
    if (session?.constructor?.name !== 'Session') throw new Error('SessionStore.create did not return a Session')
    if (String(session.id) !== runtime.masterId || !String(session.id).startsWith('orchestrator-')) {
      throw new Error('Session id is not the master session id')
    }
    if (header.agentPreset !== routerPreset) throw new Error('Session header agentPreset is not ROUTER_PRESET')
    if (header.cwd !== directory) throw new Error('Session header cwd is not the state directory')
    if (side.get('sessions').get(sessionId) !== session) throw new Error('SessionStore.get did not return the created Session')
    if ('title' in header) throw new Error('Session header grew a title field; the probe should record it instead of assuming null')
    if (fetches !== 0) throw new Error('SessionStore.create called fetch')
    return {
      passed: true,
      outcome: 'documented-block',
      commit,
      blockedAt: 'SessionController',
      condition: 'ctx.plugin(SessionController) 的 fiber 停在未激活，上下文里没有 sessionController',
      missingHooks,
      ensure: {
        calledOriginal: true,
        reached: false,
        blockedAt: 'Sessions.ensure',
        condition: 'runtime 上下文没有 sessionController，resolveAgent 没有被调用',
        thrown: ensureThrown,
      },
      sessionController: { activated: false, pluginState: pluginState(controllerFiber) },
      constructed: {
        reached: true,
        via: 'SessionStore.create',
        ctor: 'Session',
        idMatchesMaster: true,
        idPrefix: 'orchestrator-',
        role: 'orchestrator',
        agentPreset: header.agentPreset,
        title: null,
        titleHook: 'sessionController.rename',
        cwdIsStateDir: true,
        inSessionStore: true,
      },
      activatedServices,
      inactivePlugins,
      modelCalled: false,
      ghInvoked: false,
      agentDeliverySend: false,
      fetchCalled: false,
      promptCalled: false,
      webServer: 'loopback-stub',
      listened: false,
    }
  } finally {
    globalThis.fetch = origFetch
    for (const fiber of fibers.reverse()) {
      try { await Promise.resolve(fiber.dispose()) } catch { /* 旁路插件卸掉失败不影响上面的断言。 */ }
    }
  }
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
