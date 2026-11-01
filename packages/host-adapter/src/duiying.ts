import { INPUT_MAX, workerSessionId } from '@daogang/dispatcher'
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
import { readDuiyingMap, writeDuiyingMap, type DuiyingBinding, type DuiyingMapFile } from './map.ts'
import { loadDuiyingSettings } from './settings.ts'
import { startDuiyingUserHook, type DuiyingHookOptions, type DuiyingUserHook } from './user-hook.ts'

/** 对影本机服务的默认地址。只允许 loopback。 */
export const DUIYING_DEFAULT_BASE = 'http://127.0.0.1:8765'

const SUMMARY_CAP = 200
const LINE_CAP = 80

/**
 * 对影宿主。六条口径来自鎏虹 2026-11-01（对影 main `5662082`）。
 * 进窗与用户话按对影 PR #59 的形状接线。该 PR 尚未合入，真进程要等合入后再调。
 *
 * `worker-<ticketId>` 只是到岗会话名。对影收下 `worker_ref` 即弃。
 * 映射里的 deliveryKey 以 `dg-` 开头时才放进 inject。
 * 不读对影 `.env`，不调用 `/api/chat`。
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

  /**
   * `POST /api/daogang/inject`。对影 503 表示未启用或缺 secret，401 表示 secret 不对或没带头。
   */
  async sendMessage(input: SendMessageInput): Promise<HostMessage> {
    const text = requireMessageText(input.text)
    const sessionId = requireSessionId(input.sessionId)
    const secret = this.secret()
    if (!secret) throw new HostAdapterError('进窗需要先配置 DAOGANG_DUIYING_SECRET')
    const map = readDuiyingMap(this.home)
    const binding = map.sessions[sessionId]
    if (!binding) throw new HostAdapterError('到岗侧没有这个工单映射')
    const payload: Record<string, string> = {
      text,
      worker_ref: sessionId,
      mode: binding.mode,
    }
    if (binding.deliveryKey.startsWith('dg-')) payload.delivery_key = binding.deliveryKey
    const body = await this.request('/api/daogang/inject', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Daogang-Secret': secret,
      },
      body: JSON.stringify(payload),
    })
    const injected = parseInject(body)
    binding.deliveryKey = injected.delivery_key
    writeDuiyingMap(this.home, map)
    return { sessionId, text: injected.text, at: injected.at }
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
    const map = readDuiyingMap(this.home)
    map.sessions[sessionId] = binding
    writeDuiyingMap(this.home, map)
    return { id: sessionId, kind: 'worker' }
  }

  /**
   * 对影没有 interrupt 接口。另开一条到岗映射，不抢当前窗。
   * 交接备注只写到岗的 board / worker，与 LocalCli 相同。
   */
  async interrupt(input: InterruptInput): Promise<InterruptResult> {
    const result = await new LocalCliHost(this.home).interrupt(input)
    const map = readDuiyingMap(this.home)
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
    writeDuiyingMap(this.home, map)
    return result
  }

  async readContext(sessionId: string): Promise<HostContext> {
    const binding = readDuiyingMap(this.home).sessions[sessionId]
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
    await this.request('/api/health', { method: 'GET' })
    return { status: 200 }
  }

  /**
   * `POST /api/wake`。mode 默认 dev，正文截短，`skip_memory: true`。
   * 不调用 `/api/chat`，也不把响应写进映射。
   */
  async proveWake(input: { text?: string; mode?: DuiyingMode } = {}): Promise<{ status: number }> {
    if (!this.secret()) throw new HostAdapterError('对影连通证明需要先配置 DAOGANG_DUIYING_SECRET')
    await this.request('/api/wake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: normalizeMode(input.mode),
        text: clip(input.text?.trim() || '连通', LINE_CAP),
        skip_memory: true,
      }),
    })
    return { status: 200 }
  }

  /** 本机用户话钩子。默认关闭。不改 `pnpm dispatch` 的路径。 */
  startUserHook(extra: Omit<DuiyingHookOptions, 'home' | 'secret' | 'env'> = {}): Promise<DuiyingUserHook> {
    return startDuiyingUserHook({
      home: this.home,
      secret: this.options.secret,
      env: this.options.env,
      ...extra,
    })
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
    return loadDuiyingSettings(this.home, this.options).secret
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

  private async request(path: '/api/health' | '/api/wake' | '/api/daogang/inject', init: RequestInit): Promise<string> {
    const url = new URL(path, this.origin())
    let response: Response
    try {
      response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(2000) })
    } catch {
      throw new DuiyingLinkError(`对影连不上 ${path}`)
    }
    const body = await response.text().catch(() => '')
    if (response.status === 200) return body
    if (path === '/api/daogang/inject' && response.status === 401) {
      throw new DuiyingLinkError('对影 inject 拒绝：secret 不对或没带头（401）')
    }
    if (path === '/api/daogang/inject' && response.status === 503) {
      throw new DuiyingLinkError('对影 inject 未启用或对影侧缺 secret（503）')
    }
    throw new DuiyingLinkError(`对影 ${path} 返回 ${response.status}`)
  }
}

export interface DuiyingHostOptions {
  home: string
  baseUrl?: string
  /** 测试可直接传入。生产用环境变量或到岗目录里的 duiying.local.json。 */
  secret?: string
  env?: NodeJS.ProcessEnv
}

export class DuiyingNotWiredError extends Error {
  readonly method: string

  constructor(method: string) {
    super(`对影未接线：${method}`)
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

function parseInject(body: string): { delivery_key: string; text: string; at: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new DuiyingLinkError('对影 inject 响应不是 JSON')
  }
  if (!parsed || typeof parsed !== 'object') throw new DuiyingLinkError('对影 inject 响应不是 JSON')
  const record = parsed as { delivery_key?: unknown; text?: unknown; at?: unknown }
  if (typeof record.delivery_key !== 'string' || !safeDeliveryKey(record.delivery_key)) {
    throw new DuiyingLinkError('对影 inject 响应的 delivery_key 无效')
  }
  if (typeof record.text !== 'string') throw new DuiyingLinkError('对影 inject 响应缺少 text')
  if (typeof record.at !== 'string' || !record.at.trim()) throw new DuiyingLinkError('对影 inject 响应缺少 at')
  return { delivery_key: record.delivery_key, text: record.text, at: record.at }
}

function safeDeliveryKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function normalizeMode(mode: DuiyingMode | undefined): DuiyingMode {
  return mode === 'companion' ? 'companion' : 'dev'
}

function requireMessageText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new HostAdapterError('请输入一句话')
  if (Array.from(trimmed).length > INPUT_MAX) throw new HostAdapterError(`输入超过 ${INPUT_MAX} 字`)
  return trimmed
}

function requireSessionId(sessionId: string): string {
  const id = sessionId.trim()
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new HostAdapterError('sessionId 无效')
  }
  return id
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

export type { DuiyingMapFile }
