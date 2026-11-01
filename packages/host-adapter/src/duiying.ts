import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { workerSessionId } from '@daogang/dispatcher'
import {
  HostAdapterError,
  type DuiyingMode,
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
import { LocalCliHost } from './local-cli.ts'

/** 对影本机服务的默认地址。只允许 loopback。 */
export const DUIYING_DEFAULT_BASE = 'http://127.0.0.1:8765'

const SUMMARY_CAP = 200
const LINE_CAP = 80

/**
 * 对影宿主。口径来自鎏虹 2026-11-01，对影 main `5662082`。
 *
 * 到岗会话名仍是 `worker-<ticketId>`，只在到岗映射里登记，不对影起会话对象。
 * `sendMessage` 不进窗。连通证明是 `checkHealth` 与 `proveWake`，不调用 `/api/chat`。
 *
 * TODO(灵泽, 鎏虹): 进窗注入等灵泽拍板后，由对影仓 PR 添加入口。这里继续拒绝 sendMessage。
 * TODO(灵泽, 鎏虹): 对影→到岗的用户话钩子还没有。分发仍走 LocalCli，不要接 `/api/chat`。
 */
export class DuiyingHost implements HostAdapter {
  readonly id = 'duiying' as const
  readonly home: string

  constructor(options: DuiyingHostOptions) {
    if (!options.home.trim()) throw new HostAdapterError('DuiyingHost 需要一个目录')
    this.home = options.home
    this.options = options
  }

  private readonly options: DuiyingHostOptions

  async auth(): Promise<HostAuth> {
    if (!this.secret()) {
      return { state: 'unconfigured', detail: '未配置到岗自己的 DAOGANG_DUIYING_SECRET。不读对影的模型 Key。' }
    }
    return { state: 'anonymous', detail: '本机 loopback，到岗单独的共享 secret 已配置' }
  }

  async sendMessage(_input: SendMessageInput): Promise<HostMessage> {
    throw new DuiyingNotWiredError('sendMessage')
  }

  async openSession(input: OpenSessionInput): Promise<HostSession> {
    if (input.kind === 'main') return { id: 'main', kind: 'main' }
    const ticketId = requireTicket(input.ticketId)
    const sessionId = workerSessionId(ticketId)
    const binding: DuiyingBinding = {
      ticketId,
      sessionId,
      mode: normalizeMode(input.mode),
      summary: clip(input.summary ?? '', SUMMARY_CAP),
      handoffNote: '',
      deliveryKey: sessionId,
    }
    if (input.channel?.trim()) binding.channel = input.channel.trim()
    if (input.peerId?.trim()) binding.peerId = input.peerId.trim()
    const map = this.readMap()
    map.sessions[sessionId] = binding
    this.writeMap(map)
    return { id: sessionId, kind: 'worker' }
  }

  /**
   * 对影没有 interrupt 接口。第一期是另开一条到岗映射，不抢当前窗。
   * 交接备注只写到岗的 board / worker，与 LocalCli 相同。
   */
  async interrupt(input: InterruptInput): Promise<InterruptResult> {
    const result = await new LocalCliHost(this.home).interrupt(input)
    const map = this.readMap()
    const paused = map.sessions[result.pausedSessionId]
    if (paused) paused.handoffNote = result.handoffNote
    const ticketId = requireTicket(input.incoming.ticketId)
    map.sessions[result.nowSessionId] = {
      ticketId,
      sessionId: result.nowSessionId,
      mode: paused?.mode ?? 'dev',
      summary: clip(input.incoming.summary, SUMMARY_CAP),
      handoffNote: '',
      deliveryKey: result.nowSessionId,
    }
    this.writeMap(map)
    return result
  }

  async readContext(sessionId: string): Promise<HostContext> {
    const binding = this.readMap().sessions[sessionId]
    const board = await this.boardContext(sessionId)
    if (!binding && !board && sessionId !== 'main') {
      throw new HostAdapterError('到岗侧没有这个工单映射')
    }
    const context: HostContext = {
      sessionId,
      text: binding?.summary ?? '',
      handoffNote: board?.handoffNote || binding?.handoffNote || '',
    }
    if (binding?.mode) context.mode = binding.mode
    if (binding?.lastLine) context.lastLine = binding.lastLine
    return context
  }

  /** `GET /api/health`。没有对影进程时抛 DuiyingLinkError。 */
  async checkHealth(): Promise<{ status: number }> {
    const status = await this.request('/api/health', { method: 'GET' })
    return { status }
  }

  /**
   * `POST /api/wake`。mode 默认 dev，正文截短，`skip_memory: true`。
   * 不调用 `/api/chat`，也不把响应写进映射。
   */
  async proveWake(input: { text?: string; mode?: DuiyingMode } = {}): Promise<{ status: number }> {
    if (!this.secret()) throw new HostAdapterError('对影连通证明需要先配置 DAOGANG_DUIYING_SECRET')
    const status = await this.request('/api/wake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: normalizeMode(input.mode),
        text: clip(input.text?.trim() || '连通', LINE_CAP),
        skip_memory: true,
      }),
    })
    return { status }
  }

  private async boardContext(sessionId: string): Promise<HostContext | undefined> {
    try {
      return await new LocalCliHost(this.home).readContext(sessionId)
    } catch (error) {
      if (error instanceof HostAdapterError) return undefined
      throw error
    }
  }

  private secret(): string {
    const picked = this.options.secret?.trim() || this.env().DAOGANG_DUIYING_SECRET?.trim() || this.fileSecret()
    return picked ?? ''
  }

  private fileSecret(): string {
    const file = join(this.home, 'duiying.local.json')
    if (!existsSync(file)) return ''
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      throw new HostAdapterError('到岗本地对影配置读不了')
    }
    if (!parsed || typeof parsed !== 'object' || !('secret' in parsed)) return ''
    const secret = (parsed as { secret?: unknown }).secret
    return typeof secret === 'string' ? secret.trim() : ''
  }

  private env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env
  }

  private origin(): string {
    const raw = this.options.baseUrl?.trim() || this.env().DAOGANG_DUIYING_BASE_URL?.trim() || DUIYING_DEFAULT_BASE
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new HostAdapterError('对影 base URL 无效')
    }
    const host = url.hostname
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new HostAdapterError('对影只连接本机 loopback')
    }
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]' && host !== '::1') {
      throw new HostAdapterError('对影只连接本机 loopback')
    }
    if (url.username || url.password || (url.pathname && url.pathname !== '/')) {
      throw new HostAdapterError('对影 base URL 无效')
    }
    return url.origin
  }

  private async request(path: '/api/health' | '/api/wake', init: RequestInit): Promise<number> {
    const url = new URL(path, this.origin())
    let response: Response
    try {
      response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(2000) })
    } catch {
      throw new DuiyingLinkError(`对影连不上 ${path}`)
    }
    await response.text().catch(() => '')
    if (response.status !== 200) throw new DuiyingLinkError(`对影 ${path} 返回 ${response.status}`)
    return response.status
  }

  private readMap(): DuiyingMapFile {
    const file = join(this.home, 'duiying-map.json')
    if (!existsSync(file)) return { sessions: {} }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DuiyingMapFile>
      return { sessions: parsed.sessions ?? {} }
    } catch {
      throw new HostAdapterError('对影映射读不了')
    }
  }

  private writeMap(map: DuiyingMapFile): void {
    const file = join(this.home, 'duiying-map.json')
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(map)}\n`, 'utf8')
    renameSync(tmp, file)
  }
}

export interface DuiyingHostOptions {
  home: string
  baseUrl?: string
  /** 测试可直接传入。生产用环境变量或到岗目录里的 duiying.local.json。 */
  secret?: string
  env?: NodeJS.ProcessEnv
}

interface DuiyingBinding {
  ticketId: string
  sessionId: string
  mode: DuiyingMode
  summary: string
  handoffNote: string
  deliveryKey: string
  channel?: string
  peerId?: string
  lastLine?: { role: string; text: string }
}

interface DuiyingMapFile {
  sessions: Record<string, DuiyingBinding>
}

export class DuiyingNotWiredError extends Error {
  readonly method: string

  constructor(method: string) {
    super('对影未接线：sendMessage 不进窗。进窗注入等灵泽拍板后由对影侧开 PR。')
    this.name = 'DuiyingNotWiredError'
    this.method = method
  }
}

export class DuiyingLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuiyingLinkError'
  }
}

function normalizeMode(mode: DuiyingMode | undefined): DuiyingMode {
  return mode === 'companion' ? 'companion' : 'dev'
}

function requireTicket(ticketId: string | undefined): string {
  const id = ticketId?.trim() ?? ''
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new HostAdapterError('ticketId 无效')
  }
  return id
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.trim())
  if (chars.length <= max) return chars.join('')
  return chars.slice(0, max).join('')
}
