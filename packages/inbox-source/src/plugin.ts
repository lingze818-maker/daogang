import { inboxScope, type InboxScopeResult, type InboxTrigger } from './trigger.ts'

/**
 * Cordis Source 插件入口。对照上游 docs/008-cookbook.md 第 4、9、10 步。
 * 不 import `@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-*`。
 * 宿主有 `effect` 时按食谱登记 kind，并在 `context()` 给出的 SourceContext 上走 receive。
 * 没有 `effect` 时只 `register`，本地 `LocalInbox` 不受影响。
 * `configured()` 与真实 Cordis 整链未在本仓验证。
 */

export interface InboxSourceConfig {
  conversation: string
}

const CONVERSATION = /^[a-z0-9-]+$/

export function parseInboxConfig(input: unknown): InboxSourceConfig {
  const raw = input && typeof input === 'object' && 'conversation' in input
    ? (input as { conversation?: unknown }).conversation
    : undefined
  const conversation = raw === undefined || raw === '' ? 'cli' : String(raw)
  if (!CONVERSATION.test(conversation)) {
    throw new Error('inbox 配置 conversation 只允许小写字母、数字和连字符')
  }
  return { conversation }
}

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
  /** 结构上的 parse，不是 Zod。Cordis 表单是否认这个 schema，未验证。 */
  schema: { parse: parseInboxConfig },
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
    register(kind: typeof inboxKind): void
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
  const register = (): void => {
    ctx.orchestrator.sources.register(inboxKind)
  }
  if (typeof ctx.effect !== 'function') {
    register()
    return
  }
  const feed = ctx.inboxFeed ?? new InboxFeed()
  ctx.effect(() => {
    register()
    return () => {
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
