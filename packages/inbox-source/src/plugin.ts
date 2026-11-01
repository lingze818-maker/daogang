import { z } from 'zod'
import { inboxScope, type InboxScopeResult, type InboxTrigger } from './trigger.ts'

/**
 * Cordis Source 插件入口。对照上游 docs/008-cookbook.md 第 4、9、10 步。
 * 不 import `@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-*`。
 * 宿主有 `effect` 时按食谱登记 kind，并在 `context()` 给出的 SourceContext 上走 receive。
 * 没有 `effect` 时只 `register`，本地 `LocalInbox` 不受影响。
 * schema 是 Zod（`parse` / `safeParse`）。`configured()` 由宿主给出；
 * 没配 GitHub 仓库时底座 Setup 会让它返回 false，本插件此时只报 `setupPending`。
 */

export interface InboxSourceConfig {
  conversation: string
}

const CONVERSATION = /^[a-z0-9-]+$/
const CONFIG_ERROR = 'inbox 配置 conversation 只允许小写字母、数字和连字符'

/**
 * 对照 cookbook 的 Zod schema：`parse` 与 `safeParse` 都在。
 * 默认对话是 `cli`，只听这一条，不是「全部对话」。
 * `parseInboxConfig` 把缺省和空字符串收成 `cli`。schema 对空字符串和多余的键 `safeParse` 失败。
 * 底座 `SourceRegistry` 在 `safeParse` 失败时改用 `parse({})` 并关掉这一实例。
 */
export const inboxConfigSchema = z.object({
  conversation: z.string().regex(CONVERSATION).default('cli'),
}).strict()

export function parseInboxConfig(input: unknown): InboxSourceConfig {
  const record = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : {}
  if (record.conversation === undefined || record.conversation === '') delete record.conversation
  const parsed = inboxConfigSchema.safeParse(record)
  if (!parsed.success) throw new Error(CONFIG_ERROR)
  return parsed.data
}

/** 策略片段。默认 `allowed` 为空：没人能发起工作，除非配置里写上发送者。 */
export const inboxPolicySchema = z.object({
  allowed: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().max(100).optional(),
  }).strict()).default([]),
}).strict()

export interface InboxAdmissionRow {
  id: string
  label: string
  note: { zh: string; en: string }
  cells: { listedUnaddressed: boolean; unlistedAddressed: boolean; unlistedUnaddressed: boolean }
}

export const inboxKind = {
  kind: 'inbox' as const,
  title: { zh: '到岗收件', en: 'Daogang inbox' },
  description: {
    zh: '把外围分发器的一句话收成 Trigger。',
    en: 'Turns one peripheral dispatch line into a Trigger.',
  },
  health: ['inbox'] as const,
  schema: inboxConfigSchema,
  fields: [
    {
      key: 'conversation',
      type: 'text' as const,
      pattern: '[a-z0-9-]+',
      label: { zh: '对话', en: 'Conversation' },
    },
  ],
  scope(input: { meta?: { conversation?: string } }, config: unknown): InboxScopeResult {
    return inboxScope(input.meta ?? {}, parseInboxConfig(config))
  },
  policy: {
    schema: inboxPolicySchema,
    fields: [
      {
        key: 'allowed',
        type: 'rows' as const,
        label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' },
        columns: [
          { key: 'id', type: 'text' as const, label: { zh: '发送者', en: 'Sender' } },
          { key: 'name', type: 'text' as const, label: { zh: '名字', en: 'Name' }, optional: true },
        ],
      },
    ],
    explicit: {
      zh: '命令行直接对智能体说话。',
      en: 'The command line speaks to the agent directly.',
    },
    rows(config: unknown): InboxAdmissionRow[] {
      const parsed = parseInboxConfig(config)
      return [{
        id: parsed.conversation,
        label: parsed.conversation,
        note: { zh: '直接发言', en: 'Direct' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false },
      }]
    },
  },
}

export interface InboxHealth {
  state: 'ready' | 'paused' | 'error'
  detail: string
  code?: 'setupPending' | 'sourceOff'
  at?: string
}

export interface InboxLoopHost {
  ready?: Promise<unknown>
  configured?(): boolean
  config?(kind: string): unknown
  receive?(trigger: InboxTrigger): unknown
  report?(entry: string, health: InboxHealth): void
}

export interface InboxHostSketch {
  sources: {
    /** 底座 `SourceRegistry.register` 返回卸载函数。草图宿主可以不返回。 */
    register(kind: typeof inboxKind): void | (() => void)
    unregister?(kind: string): void
  }
  /** 上游 SourceHost.context。有则用它拿 SourceContext，不 import host.ts。 */
  context?(kind: typeof inboxKind): InboxLoopHost
  report?(entry: string, health: InboxHealth): void
}

export interface InboxPluginContext {
  orchestrator: InboxHostSketch
  effect?(run: () => void | (() => void | Promise<void>), label?: string): void
  /** 外围或测试推入 Trigger。Cordis 不提供这个字段时，循环没有可 receive 的事件。 */
  inboxFeed?: InboxFeed
}

/** 插件内部队列。稳定 id 由调用方放在 Trigger 上，这里不另造游标。 */
export class InboxFeed {
  private readonly queued: InboxTrigger[] = []
  private readonly waiters: Array<(trigger: InboxTrigger | undefined) => void> = []

  push(trigger: InboxTrigger): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(trigger)
      return
    }
    this.queued.push(trigger)
  }

  take(signal: AbortSignal): Promise<InboxTrigger | undefined> {
    if (signal.aborted) return Promise.resolve(undefined)
    const next = this.queued.shift()
    if (next) return Promise.resolve(next)
    return new Promise((resolve) => {
      const finish = (trigger: InboxTrigger | undefined): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(trigger)
      }
      const onAbort = (): void => {
        const index = this.waiters.indexOf(finish)
        if (index >= 0) this.waiters.splice(index, 1)
        finish(undefined)
      }
      this.waiters.push(finish)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

const HEALTH_DETAIL = {
  setupPending: 'Waiting for the deployment check',
  sourceOff: 'Off',
} as const

function brief(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const one = message.replace(/\s+/g, ' ').trim() || 'inbox 失败'
  return Array.from(one).slice(0, 80).join('')
}

function openHost(orchestrator: InboxHostSketch): InboxLoopHost {
  if (typeof orchestrator.context === 'function') return orchestrator.context(inboxKind)
  return orchestrator
}

/**
 * 食谱里的接收循环形状：等 ready，setup 未完成就停，关着就不读，
 * 然后 scope（只看 meta 与配置）之后仍把 Trigger 交给 receive，不在循环里悄悄丢掉。
 */
export async function watchInbox(host: InboxLoopHost, feed: InboxFeed, signal: AbortSignal): Promise<void> {
  if (host.ready) await host.ready
  if (signal.aborted) return
  if (typeof host.configured === 'function' && !host.configured()) {
    host.report?.('inbox', { state: 'paused', detail: HEALTH_DETAIL.setupPending, code: 'setupPending' })
    return
  }
  if (typeof host.receive !== 'function') {
    host.report?.('inbox', { state: 'paused', detail: 'inbox receive 未接上' })
    return
  }
  while (!signal.aborted) {
    if (typeof host.config === 'function' && host.config('inbox') == null) {
      host.report?.('inbox', { state: 'paused', detail: HEALTH_DETAIL.sourceOff, code: 'sourceOff' })
      return
    }
    const config = typeof host.config === 'function' ? host.config('inbox') : { conversation: 'cli' }
    const trigger = await feed.take(signal)
    if (!trigger || signal.aborted) return
    inboxKind.scope({ meta: trigger.meta }, config)
    await host.receive(trigger)
    host.report?.('inbox', { state: 'ready', detail: trigger.id, at: trigger.at })
  }
}

async function startInboxLoop(orchestrator: InboxHostSketch, feed: InboxFeed, signal: AbortSignal): Promise<void> {
  let host: InboxLoopHost | undefined
  try {
    host = openHost(orchestrator)
    await watchInbox(host, feed, signal)
  } catch (error) {
    const detail = brief(error)
    try {
      if (host?.report) host.report('inbox', { state: 'error', detail })
      else orchestrator.report?.('inbox', { state: 'error', detail })
    } catch {
      // 健康上报自己失败时不再抛，避免变成未处理拒绝。
    }
  }
}

export function apply(ctx: InboxPluginContext): void {
  const register = (): (() => void) | void => ctx.orchestrator.sources.register(inboxKind)
  if (typeof ctx.effect !== 'function') {
    register()
    return
  }
  // Cordis 的 context 读未 inject 的字段会抛错。inboxFeed 只给测试塞队列，真宿主上没有这个字段。
  const feed = 'inboxFeed' in ctx && ctx.inboxFeed instanceof InboxFeed ? ctx.inboxFeed : new InboxFeed()
  ctx.effect(() => {
    const dispose = register()
    return () => {
      if (typeof dispose === 'function') dispose()
      ctx.orchestrator.sources.unregister?.(inboxKind.kind)
    }
  }, 'inbox: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = startInboxLoop(ctx.orchestrator, feed, controller.signal)
    return async () => {
      controller.abort()
      await running
    }
  })
}

export const name = 'daogang-inbox'
export const inject = ['orchestrator'] as const
export const pluginName = name
export const pluginInject = inject
