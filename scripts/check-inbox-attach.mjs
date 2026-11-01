#!/usr/bin/env node
/**
 * 无密钥检查 inbox Source 的挂载形状。
 *
 *   node scripts/check-inbox-attach.mjs
 *   DAOGANG_DSH_ROOT=/path/to/dsh-superagent-prototype node scripts/check-inbox-attach.mjs
 *
 * 不启动 worker Session，不读 API key，不修改上游克隆。
 * 给了根目录时，用该克隆里的 SourceRegistry / Setup 跑静态检查。
 * 打印的结果不含绝对路径。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function brief(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\/[\w.+@~-]+(?:\/[\w.+@~-]+)+/g, '<path>').replace(/\s+/g, ' ').trim().slice(0, 240)
}

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'))
}

const report = {
  package: {},
  dsh: { checked: false },
}

const pkg = readJson(new URL('./package.json', new URL('../packages/inbox-source/', import.meta.url)))
const patch = readFileSync(new URL('../packages/inbox-source/cordis.patch.yml', import.meta.url), 'utf8')
const inbox = await import(new URL('../packages/inbox-source/src/index.ts', import.meta.url).href)

report.package = {
  name: pkg.name,
  export: pkg.exports?.['.'],
  zod: pkg.dependencies?.zod ?? null,
  cordisDependency: pkg.dependencies?.['@deepseek-ai/cordis'] ?? null,
  cordisPeer: pkg.peerDependencies?.['@deepseek-ai/cordis'] ?? null,
  bundlePatch: pkg.dsh?.bundle?.patch ?? null,
  pluginName: inbox.name,
  inject: [...inbox.inject],
  kind: inbox.inboxKind.kind,
  schemaSafeParse: typeof inbox.inboxKind.schema.safeParse,
  schemaParseEmpty: inbox.inboxKind.schema.parse({}),
  policyParseEmpty: inbox.inboxKind.policy.schema.parse({}),
  patchInsertsDisabled: patch.includes("name: '@daogang/inbox-source'") && patch.includes('disabled: true'),
}

const root = process.env.DAOGANG_DSH_ROOT
if (root && !process.execArgv.includes('--experimental-transform-types')) {
  // 上游源码使用参数属性。Node 的默认 strip-only 加载会拒绝它；transform-types 可以编过，不必先 build。
  const child = spawnSync(process.execPath, ['--experimental-transform-types', ...process.execArgv, process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(child.status ?? 1)
}

if (!root) {
  report.dsh = { checked: false, reason: 'DAOGANG_DSH_ROOT unset' }
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

report.dsh.checked = true
try {
  const manifest = readJson(join(root, 'package.json'))
  if (manifest.name !== 'dsh-superagent') {
    throw new Error(`package name is ${manifest.name || 'empty'}, expected dsh-superagent`)
  }
  let commit = ''
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    commit = ''
  }
  report.dsh.packageName = manifest.name
  report.dsh.commit = commit
  if (!existsSync(join(root, 'node_modules', 'zod'))) {
    throw new Error('clone node_modules is missing; run pnpm install in the clone first')
  }

  const registryMod = await import(pathToFileURL(join(root, 'src/sources/registry.ts')).href)
  const policyMod = await import(pathToFileURL(join(root, 'src/policy.ts')).href)
  const deploymentMod = await import(pathToFileURL(join(root, 'src/deployment.ts')).href)
  const setupMod = await import(pathToFileURL(join(root, 'src/app/setup.ts')).href)
  const setupErrorMod = await import(pathToFileURL(join(root, 'src/setup.ts')).href)

  const { SourceRegistry } = registryMod
  const { SettingsSchema } = policyMod
  const { SETUP_FIELDS, resolveDeployment, resolveFeishuBot } = deploymentMod
  const { Setup } = setupMod
  const { SetupError } = setupErrorMod

  const bare = new SourceRegistry(() => SettingsSchema.parse({}))
  let bareRejected = false
  let bareError = ''
  bare.register({
    kind: 'bare',
    title: { zh: '裸', en: 'Bare' },
    description: { zh: '', en: '' },
    health: ['bare-health'],
    schema: { parse(input) { return input && typeof input === 'object' ? input : {} } },
    fields: [],
  })
  try {
    bare.instances()
  } catch (error) {
    bareRejected = true
    bareError = brief(error)
  }
  report.dsh.bareSchemaRejected = bareRejected
  report.dsh.bareSchemaError = bareError

  const sources = new SourceRegistry(() => SettingsSchema.parse({}))
  const dispose = sources.register(inbox.inboxKind)
  const empty = SettingsSchema.parse({})
  const installed = sources.instances(empty).find((item) => item.id === 'inbox')
  const bad = SettingsSchema.parse({
    sources: { inbox: { enabled: true, config: { conversation: 'NOPE', extra: 1 } } },
  })
  const rejected = sources.instances(bad).find((item) => item.id === 'inbox')
  let validateEmpty = null
  let validateBad = null
  try {
    validateEmpty = sources.validate('inbox', { enabled: true, config: {} })
  } catch (error) {
    validateEmpty = { threw: brief(error) }
  }
  try {
    sources.validate('inbox', { enabled: true, config: { conversation: 'NOPE' } })
    validateBad = { threw: false }
  } catch (error) {
    validateBad = { threw: true, error: brief(error) }
  }
  report.dsh.registry = {
    installed,
    invalidConfigDisables: rejected,
    validateEmpty,
    validateBad,
    policyPart: sources.policyPart('inbox', empty),
    scopeCli: sources.scope({ source: 'inbox', meta: { conversation: 'cli' } }, empty),
    scopeOther: sources.scope({ source: 'inbox', meta: { conversation: 'other' } }, empty),
    scopeWhenDisabled: sources.scope({ source: 'inbox', meta: { conversation: 'cli' } }, bad),
    disposeIsFunction: typeof dispose === 'function',
  }
  if (typeof dispose === 'function') dispose()
  report.dsh.unregistered = sources.kind('inbox') === undefined

  const machine = {
    stateDir: join(tmpdir(), 'daogang-inbox-setup-check'),
    promptMaxChars: { get() { return 100000 } },
    admissionContextMaxPages: { get() { return 10 } },
    admissionContextTimeoutMs: { get() { return 15000 } },
  }
  const probe = async () => {
    throw new Error('probe was called')
  }
  let githubEmpty = null
  try {
    await resolveDeployment(machine, {}, probe)
    githubEmpty = { threw: false }
  } catch (error) {
    githubEmpty = {
      threw: error instanceof SetupError,
      code: error instanceof SetupError ? error.code : '',
      place: error instanceof SetupError ? error.place : '',
    }
  }
  let feishuEmpty = null
  try {
    feishuEmpty = { value: await resolveFeishuBot(machine, {}, probe) ?? null }
  } catch (error) {
    feishuEmpty = { threw: brief(error) }
  }
  const setup = new Setup({
    context: {},
    machine,
    lifetime: new AbortController().signal,
    restart() {},
  })
  const settings = SettingsSchema.parse({})
  const ran = await setup.run(settings)
  report.dsh.setup = {
    setupFields: SETUP_FIELDS,
    inboxInSetupFields: Object.hasOwn(SETUP_FIELDS, 'inbox'),
    githubEmpty,
    feishuEmpty,
    runReturned: ran,
    configured: setup.configured(),
    problemCode: setup.problem?.code ?? null,
    problemPlace: setup.problem?.place ?? null,
  }
} catch (error) {
  report.dsh.failed = brief(error)
  console.log(JSON.stringify(report, null, 2))
  process.exit(1)
}

console.log(JSON.stringify(report, null, 2))
if (report.dsh.failed) process.exit(1)
if (report.dsh.bareSchemaRejected !== true) process.exit(1)
if (report.dsh.setup?.configured !== false) process.exit(1)
if (report.dsh.registry?.invalidConfigDisables?.enabled !== false) process.exit(1)
