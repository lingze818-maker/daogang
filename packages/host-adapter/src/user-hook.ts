import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dispatchLine, openRuntime } from '@daogang/dispatcher'
import { HostAdapterError, type DuiyingMode } from './adapter.ts'
import { findByDeliveryKey, readDuiyingMap, writeDuiyingMap } from './map.ts'
import { loadDuiyingSettings } from './settings.ts'

export const DUIYING_HOOK_PATH = '/hooks/duiying-user'
export const DUIYING_HOOK_DEFAULT_PORT = 8787
const TEXT_CAP = 80
const BODY_MAX = 1024

export interface DuiyingUserLine {
  text: string
  mode: DuiyingMode
  sessionId: string | null
  ticketId: string | null
}

/** 用户话进入到岗的口。默认实现是外围 `dispatchLine`，不调用对影 `/api/chat`。 */
export interface DuiyingUserPort {
  take(line: DuiyingUserLine): Promise<void>
}

export interface DuiyingHookOptions {
  home: string
  secret?: string
  env?: NodeJS.ProcessEnv
  /** 显式开关。不传时看 `DAOGANG_DUIYING_HOOK` 或 `duiying.local.json` 的 `hook`。默认关。 */
  hook?: boolean
  port?: number
  dispatch?: DuiyingUserPort
}

export interface DuiyingUserHook {
  url: string
  close(): Promise<void>
}

/**
 * 本机钩子。对影把 `daogang.callback_url` 指到返回的 url。
 * 只绑 loopback。请求体只收 role、text、mode、可选 delivery_key。
 */
export async function startDuiyingUserHook(options: DuiyingHookOptions): Promise<DuiyingUserHook> {
  const settings = loadDuiyingSettings(options.home, options)
  if (!settings.hook) {
    throw new HostAdapterError('用户话钩子默认关闭。设置 DAOGANG_DUIYING_HOOK=1，或在 duiying.local.json 里写 "hook": true')
  }
  if (!settings.secret) throw new HostAdapterError('用户话钩子需要先配置 DAOGANG_DUIYING_SECRET')
  const port = resolvePort(options.port, options.env ?? process.env)
  const dispatch = options.dispatch ?? peripheralDispatchPort(options.home, options.env ?? {})
  const server = createServer((req, res) => {
    void handle(req, res, options.home, settings.secret, dispatch)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new HostAdapterError('用户话钩子没有绑上端口')
  }
  return {
    url: `http://127.0.0.1:${address.port}${DUIYING_HOOK_PATH}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

export function peripheralDispatchPort(home: string, env: NodeJS.ProcessEnv = {}): DuiyingUserPort {
  return {
    async take(line) {
      const runtimeEnv: NodeJS.ProcessEnv = { ...env, DAOGANG_EXECUTOR: 'local' }
      delete runtimeEnv.DAOGANG_DSH_ROOT
      delete runtimeEnv.DEEPSEEK_API_KEY
      await dispatchLine(line.text, openRuntime(home, runtimeEnv))
    },
  }
}

function resolvePort(explicit: number | undefined, env: NodeJS.ProcessEnv): number {
  if (explicit !== undefined) return explicit
  const raw = env.DAOGANG_DUIYING_HOOK_PORT?.trim()
  if (!raw) return DUIYING_HOOK_DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new HostAdapterError('用户话钩子端口无效')
  }
  return port
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  home: string,
  secret: string,
  dispatch: DuiyingUserPort,
): Promise<void> {
  if (req.method !== 'POST' || req.url?.split('?')[0] !== DUIYING_HOOK_PATH) {
    send(res, 404, { error: 'not found' })
    return
  }
  const header = req.headers['x-daogang-secret']
  const got = Array.isArray(header) ? header[0] ?? '' : header ?? ''
  if (!sameSecret(got, secret)) {
    send(res, 401, { error: 'unauthorized' })
    return
  }
  let raw = ''
  try {
    raw = await readBody(req)
  } catch {
    send(res, 400, { error: 'bad request' })
    return
  }
  const line = parseUserLine(raw)
  if (!line) {
    send(res, 400, { error: 'bad request' })
    return
  }
  const resolved = rememberLine(home, line)
  try {
    await dispatch.take(resolved)
  } catch {
    send(res, 500, { error: 'dispatch failed' })
    return
  }
  send(res, 200, { ok: true })
}

function parseUserLine(raw: string): { text: string; mode: DuiyingMode; deliveryKey?: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const record = parsed as { role?: unknown; text?: unknown; mode?: unknown; delivery_key?: unknown }
  if (record.role !== 'user') return undefined
  if (typeof record.text !== 'string') return undefined
  const text = record.text.trim()
  if (!text || Array.from(text).length > TEXT_CAP) return undefined
  if (record.mode !== 'companion' && record.mode !== 'dev') return undefined
  if (record.delivery_key === undefined) return { text, mode: record.mode }
  if (typeof record.delivery_key !== 'string' || !safeKey(record.delivery_key)) return undefined
  return { text, mode: record.mode, deliveryKey: record.delivery_key }
}

function rememberLine(home: string, line: { text: string; mode: DuiyingMode; deliveryKey?: string }): DuiyingUserLine {
  if (!line.deliveryKey) {
    return { text: line.text, mode: line.mode, sessionId: null, ticketId: null }
  }
  const map = readDuiyingMap(home)
  const binding = findByDeliveryKey(map, line.deliveryKey)
  if (!binding) {
    return { text: line.text, mode: line.mode, sessionId: null, ticketId: null }
  }
  binding.lastLine = { role: 'user', text: line.text }
  writeDuiyingMap(home, map)
  return { text: line.text, mode: line.mode, sessionId: binding.sessionId, ticketId: binding.ticketId }
}

function safeKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function sameSecret(got: string, expect: string): boolean {
  const left = Buffer.from(got)
  const right = Buffer.from(expect)
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_MAX) {
        reject(new Error('too big'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}
