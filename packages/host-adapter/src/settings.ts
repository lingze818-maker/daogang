import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HostAdapterError } from './adapter.ts'

export interface DuiyingSettings {
  secret: string
  hook: boolean
}

/** 到岗自己的 secret 与钩子开关。不读对影目录里的 .env。 */
export function loadDuiyingSettings(home: string, options: {
  secret?: string
  env?: NodeJS.ProcessEnv
  hook?: boolean
} = {}): DuiyingSettings {
  const env = options.env ?? process.env
  const file = readLocalFile(home)
  const secret = options.secret?.trim() || env.DAOGANG_DUIYING_SECRET?.trim() || file.secret
  const hook = options.hook ?? hookFromEnv(env) ?? file.hook
  return { secret, hook }
}

function hookFromEnv(env: NodeJS.ProcessEnv): boolean | undefined {
  const raw = env.DAOGANG_DUIYING_HOOK?.trim().toLowerCase()
  if (raw === undefined || raw === '') return undefined
  return raw === '1' || raw === 'true' || raw === 'on'
}

function readLocalFile(home: string): { secret: string; hook: boolean } {
  const file = join(home, 'duiying.local.json')
  if (!existsSync(file)) return { secret: '', hook: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new HostAdapterError('到岗本地对影配置读不了')
  }
  if (!parsed || typeof parsed !== 'object') return { secret: '', hook: false }
  const record = parsed as { secret?: unknown; hook?: unknown }
  const secret = typeof record.secret === 'string' ? record.secret.trim() : ''
  return { secret, hook: record.hook === true }
}
