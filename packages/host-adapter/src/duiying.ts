import {
  type HostAdapter,
  type HostAuth,
  type HostContext,
  type HostMessage,
  type HostSession,
  type InterruptInput,
  type InterruptResult,
  type OpenSessionInput,
  type SendMessageInput,
} from './adapter.ts'

/**
 * 对影宿主桩。和鎏虹对齐之前，这里没有客户端。
 *
 * TODO(鎏虹): sendMessage — 对影窗口里的一句从哪个入口送出。
 * TODO(鎏虹): openSession — 会话名是否沿用 `worker-<ticketId>`，还是对影已有自己的名字。
 * TODO(鎏虹): interrupt — 放下当前会话时，不超过 200 字的交接备注写回哪里。
 * TODO(鎏虹): readContext — 能读到的范围；哪些字段不能进公开仓。
 * TODO(鎏虹): auth — 用本机已有登录态，还是单独凭证。凭证不要写入这个仓库。
 *
 * 不要在这个文件里放私有对话样本，也不要编一个看起来能调用的接口。
 */
export class DuiyingHost implements HostAdapter {
  readonly id = 'duiying' as const

  async sendMessage(_input: SendMessageInput): Promise<HostMessage> {
    throw new DuiyingNotWiredError('sendMessage')
  }

  async openSession(_input: OpenSessionInput): Promise<HostSession> {
    throw new DuiyingNotWiredError('openSession')
  }

  async interrupt(_input: InterruptInput): Promise<InterruptResult> {
    throw new DuiyingNotWiredError('interrupt')
  }

  async readContext(_sessionId: string): Promise<HostContext> {
    throw new DuiyingNotWiredError('readContext')
  }

  async auth(): Promise<HostAuth> {
    return { state: 'unconfigured', detail: '对影鉴权未对齐，不读取密钥' }
  }
}

export class DuiyingNotWiredError extends Error {
  readonly method: string

  constructor(method: string) {
    super(`对影未接线：${method} 还没有和鎏虹对齐的入口。这一桩不访问网络。`)
    this.name = 'DuiyingNotWiredError'
    this.method = method
  }
}
