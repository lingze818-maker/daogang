import type { Decision } from './decision.ts'

export interface InboxActor {
  source: 'inbox'
  id: string
}

export interface InboxTrigger {
  id: string
  source: 'inbox'
  threads: [{ source: 'inbox'; id: string }]
  actor: InboxActor
  human: true
  /** CLI 输入视为对智能体的直接发言，对齐底座 explicit 直通，不走 inferred 研判。 */
  addressed: 'direct'
  at: string
  text: string
  channel: {
    source: 'inbox'
    thread: string
    address: { conversation: string; message: string }
  }
  meta: {
    conversation: string
    messageId: string
    target: Decision['target']
    urgency: Decision['urgency']
    lane: 'chat' | 'task'
    card: Decision['cards'][number]
    policy: 'explicit'
  }
}

export interface InboxScopeResult {
  listened: boolean
  observed: boolean
  row?: string
  reason?: string
}

export function inboxTrigger(input: {
  messageId: string
  at: string
  text: string
  decision: Decision
  lane: 'chat' | 'task'
  actorId?: string
  conversation?: string
}): InboxTrigger {
  const conversation = input.conversation ?? 'cli'
  const lane = input.lane
  const card = input.decision.cards.find((item) => item.kind === lane)
  if (!card) {
    throw new Error(`分发结果缺少 ${lane} 卡片`)
  }
  const thread = `${conversation}:${input.messageId}`
  return {
    id: `inbox:${input.messageId}:${lane}`,
    source: 'inbox',
    threads: [{ source: 'inbox', id: thread }],
    actor: { source: 'inbox', id: input.actorId ?? 'cli-user' },
    human: true,
    addressed: 'direct',
    at: input.at,
    text: input.text,
    channel: {
      source: 'inbox',
      thread: `inbox:${thread}`,
      address: { conversation, message: input.messageId },
    },
    meta: {
      conversation,
      messageId: input.messageId,
      target: input.decision.target,
      urgency: input.decision.urgency,
      lane,
      card,
      policy: 'explicit',
    },
  }
}

/** 只看 meta 与配置。未列入的对话记为 filtered，不在翻译阶段悄悄丢掉。 */
export function inboxScope(
  meta: { conversation?: string },
  config: { conversation: string },
): InboxScopeResult {
  if (meta.conversation !== config.conversation) {
    return { listened: false, observed: false, reason: 'conversation_not_listed' }
  }
  return { listened: true, observed: false, row: config.conversation }
}
