/** 宿主无关的五个动作。分发器仍按自己的规则派活；这里只负责把结果交到某个宿主。 */

export type HostId = 'local-cli' | 'duiying' | 'zcode'
export type SessionKind = 'main' | 'worker'
export type Urgency = 0 | 1 | 2

export interface HostSession {
  id: string
  kind: SessionKind
}

export interface HostMessage {
  sessionId: string
  text: string
  at: string
}

export type DuiyingMode = 'companion' | 'dev'

export interface HostContext {
  sessionId: string
  /** 工单摘要。没有摘要时为空字符串，不回灌对话全文。 */
  text: string
  /** 交接备注，最多 200 字。没有则为空。 */
  handoffNote: string
  /** 对影映射上的 mode。本地 CLI 不填。 */
  mode?: DuiyingMode
  /** 最近一句的角色和截断正文。没有则省略。 */
  lastLine?: { role: string; text: string }
}

export interface HostAuth {
  state: 'anonymous' | 'unconfigured'
  detail: string
}

export interface SendMessageInput {
  sessionId: string
  text: string
  at?: string
}

export interface OpenSessionInput {
  kind: SessionKind
  /** `kind: 'worker'` 时必填。到岗会话名是 `worker-<ticketId>`。 */
  ticketId?: string
  /** 对影映射用。本地 CLI 忽略。 */
  mode?: DuiyingMode
  /** 写进对影映射的工单摘要。过长会截断。本地 CLI 忽略。 */
  summary?: string
  /** 只进到岗映射，不出现在 readContext。本地 CLI 忽略。 */
  channel?: string
  peerId?: string
}

export interface InterruptIncoming {
  ticketId: string
  summary: string
  urgency: Urgency
  auditId: string
}

export interface InterruptInput {
  /** 当前要放下的会话。 */
  sessionId: string
  incoming: InterruptIncoming
}

export interface InterruptResult {
  pausedSessionId: string
  handoffNote: string
  nowSessionId: string
}

export interface HostAdapter {
  readonly id: HostId
  sendMessage(input: SendMessageInput): Promise<HostMessage>
  openSession(input: OpenSessionInput): Promise<HostSession>
  interrupt(input: InterruptInput): Promise<InterruptResult>
  readContext(sessionId: string): Promise<HostContext>
  auth(): Promise<HostAuth>
}

export class HostAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HostAdapterError'
  }
}
