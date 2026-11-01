import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 从 DAOGANG_DSH_ROOT 指向的 dsh-superagent-prototype 克隆里加载 `DshExecutor`。
 * 只动态 import 固定相对路径，不把上游仓复制进本仓，顶层也不依赖 `@deepseek-ai/dsh-*`。
 * 站位宿主只提供 effects.handle / enqueue。不调用 handler，因此不会跑进私有 launch()。
 */

const CANDIDATES = ['lib/executor/dsh.js', 'src/executor/dsh.js', 'src/executor/dsh.ts'] as const

export interface DshEnqueueEvent {
  kind: string
  key: string
  payload: { ticketId?: string; assignmentId?: string }
}

export interface DshExecutorLike {
  start(ticket: { id: string }, assignment: { id: string }): void
  deliver(ticket: { id: string }, assignment: { id: string }): void
}

export interface OpenedDshExecutor {
  executor: DshExecutorLike
  events: DshEnqueueEvent[]
  /** 实际加载到的文件，便于测试确认没有另写一份入队。 */
  entry: string
}

interface ExecutorModule {
  DshExecutor?: new (host: { effects: DshEffects }) => DshExecutorLike
  workerSessionId?: (ticketId: string) => string
}

interface DshEffects {
  enqueue(kind: string, key: string, payload: { ticketId?: string; assignmentId?: string }): void
  handle(kind: string, run: (payload: unknown, key: string) => Promise<void>, options?: unknown): void
}

function isInside(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function resolveDshPackageRoot(root: string): string {
  const abs = resolve(root)
  if (!existsSync(abs)) throw new Error(`DAOGANG_DSH_ROOT 不存在：${abs}`)
  const real = realpathSync(abs)
  if (!statSync(real).isDirectory()) throw new Error(`DAOGANG_DSH_ROOT 不是目录：${real}`)
  const manifest = join(real, 'package.json')
  if (!existsSync(manifest)) throw new Error('DAOGANG_DSH_ROOT 缺少 package.json')
  let name = ''
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
    name = typeof parsed.name === 'string' ? parsed.name : ''
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`DAOGANG_DSH_ROOT 的 package.json 无法解析：${detail}`)
  }
  if (name !== 'dsh-superagent') {
    throw new Error(`package.json name 是 ${name || '空'}，需要 dsh-superagent`)
  }
  return real
}

export async function openDshExecutor(root: string): Promise<OpenedDshExecutor> {
  const real = resolveDshPackageRoot(root)
  const failures: string[] = []
  for (const rel of CANDIDATES) {
    const entry = join(real, rel)
    if (!existsSync(entry) || !isInside(real, entry)) continue
    let mod: ExecutorModule
    try {
      mod = await import(pathToFileURL(entry).href) as ExecutorModule
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      failures.push(`${rel} 加载失败：${detail}`)
      continue
    }
    const Executor = mod.DshExecutor
    if (typeof Executor !== 'function') {
      failures.push(`${rel} 没有导出 DshExecutor`)
      continue
    }
    if (typeof mod.workerSessionId === 'function' && mod.workerSessionId('probe') !== 'worker-probe') {
      throw new Error('上游 workerSessionId 与 worker-<ticketId> 不一致')
    }
    const events: DshEnqueueEvent[] = []
    const effects: DshEffects = {
      enqueue(kind, key, payload) {
        events.push({
          kind,
          key,
          payload: {
            ...(payload?.ticketId !== undefined ? { ticketId: payload.ticketId } : {}),
            ...(payload?.assignmentId !== undefined ? { assignmentId: payload.assignmentId } : {}),
          },
        })
      },
      handle() {
        // 构造函数会登记 launch / delivery。这里不运行 handler。
      },
    }
    const executor = new Executor({ effects })
    return { executor, events, entry }
  }
  if (failures.length === 0) {
    throw new Error('找不到 src/executor/dsh.ts 或 lib/executor/dsh.js')
  }
  throw new Error(failures[0] ?? 'DshExecutor 加载失败')
}
