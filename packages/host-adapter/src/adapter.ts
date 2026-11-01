/** 宿主无关的五个动作。分发器仍按自己的规则派活；这里只负责把结果交到某个宿主。 */

export type HostId = 'local-cli' | 'duiying'
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

export interface HostContext {
  sessionId: string
  /** 本地是工单摘要或主窗那一句。没有记录时为空字符串。 */
  text: string
  /** 交接备注，最多 200 字。没有则为空。 */
  handoffNote: string
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
  /** `kind: 'worker'` 时必填。会话名是 `worker-<ticketId>`。 */
  ticketId?: string
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
