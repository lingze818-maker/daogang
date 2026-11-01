/**
 * Cookbook 008 的插件入口形状。
 * 本函数只向调用方传入的宿主登记 kind，不 import Cordis，也不连接 DSH。
 * 真正的 `ctx.orchestrator.sources.register` 要等 peer 装上再接。
 */
export const inboxKind = {
  kind: 'inbox' as const,
  title: { zh: '到岗收件', en: 'Daogang inbox' },
  description: {
    zh: '把外围分发器的一句话收成 Trigger。',
    en: 'Turns one peripheral dispatch line into a Trigger.',
  },
  policy: 'explicit' as const,
  health: ['inbox'] as const,
}

export interface InboxHostSketch {
  sources: {
    register(kind: typeof inboxKind): void
  }
}

export function apply(ctx: { orchestrator: InboxHostSketch }): void {
  ctx.orchestrator.sources.register(inboxKind)
}

export const pluginName = 'daogang-inbox'
export const pluginInject = ['orchestrator'] as const
