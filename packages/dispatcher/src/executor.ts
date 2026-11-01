import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { openDshExecutor, type DshEnqueueEvent, type DshExecutorLike } from './dsh-load.ts'

/**
 * 会话执行口。默认 LocalExecutor。
 * DshExecutorAdapter 不在顶层 import `@deepseek-ai/dsh-*`。
 * 设置了 DAOGANG_DSH_ROOT 时，按路径加载克隆里的 `DshExecutor`，
 * 调用公开的 `start` / `deliver`。上游形状（`src/executor/dsh.ts`）：
 * `start` → `effects.enqueue('launch', assignmentId, { ticketId, assignmentId })`
 * `deliver` → `effects.enqueue('delivery', ticketId, { ticketId })`
 * 会话名是 `worker-${ticketId}`。
 * 站位 effects 不跑 handler，所以没有私有 launch()，也没有活的 worker Session。
 */

export interface ExecutorCard {
  role: string
  kind: 'chat' | 'task'
  summary: string
}

/** 到岗侧的派工。对应底座 Assignment 的字段，不是那个类。 */
export interface ExecutorAssignment {
  ticketId: string
  session: string
  assignmentId: string
  urgency: 0 | 1 | 2
  cards: ExecutorCard[]
  text: string
  handoffNote: string
}

export interface Delivery {
  ticketId: string
  session: string
  text: string
}

export interface ExecutorLaunch {
  runtime: 'local' | 'dsh'
  session: string
  ticketId: string
}

export interface DshCall {
  method: 'start' | 'deliver'
  effect: 'launch' | 'delivery'
  session: string
  payload: { ticketId: string; assignmentId?: string }
}

export interface ExecutorPort {
  readonly kind: 'local' | 'dsh'
  /** 新的当前工单。排队的不调用。 */
  start(assignment: ExecutorAssignment): Promise<ExecutorLaunch>
  /** 往已经在跑的 worker 会话补一句。底座对应 delivery，不是新开票。 */
  deliver(input: Delivery): Promise<void>
}

export function workerSessionId(ticketId: string): string {
  return `worker-${ticketId}`
}

/** 上游 `DshExecutor.start` 会入队的那一次 launch。 */
export function planDshStart(assignment: ExecutorAssignment): DshCall {
  return {
    method: 'start',
    effect: 'launch',
    session: workerSessionId(assignment.ticketId),
    payload: { ticketId: assignment.ticketId, assignmentId: assignment.assignmentId },
  }
}

/** 上游 `DshExecutor.deliver` 会入队的那一次 delivery。 */
export function planDshDeliver(input: Delivery): DshCall {
  return {
    method: 'deliver',
    effect: 'delivery',
    session: input.session,
    payload: { ticketId: input.ticketId },
  }
}

export class DshNotWiredError extends Error {
  readonly call: DshCall

  constructor(call: DshCall) {
    super(`DSH 未接线：${call.method} 会 enqueue('${call.effect}')。未设置 DAOGANG_DSH_ROOT`)
    this.name = 'DshNotWiredError'
    this.call = call
  }
}

/** 根目录已设置，但克隆里的 DshExecutor 没能完成这次 enqueue。 */
export class DshLoadError extends Error {
  readonly call: DshCall

  constructor(call: DshCall, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    const one = detail.replace(/\s+/g, ' ').trim() || '加载失败'
    const message = `DSH 加载失败：${call.method} enqueue('${call.effect}')。${one}`
    super(Array.from(message).slice(0, 110).join(''))
    this.name = 'DshLoadError'
    this.call = call
  }
}

export interface DshEnqueue extends DshCall {
  key: string
}

interface LaunchRecord extends ExecutorAssignment {
  at: string
}

interface DeliveryRecord extends Delivery {
  at: string
}

interface ExecutorLog {
  launches: LaunchRecord[]
  deliveries: DeliveryRecord[]
}

export class LocalExecutor implements ExecutorPort {
  readonly kind = 'local' as const
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  async start(assignment: ExecutorAssignment): Promise<ExecutorLaunch> {
    const state = this.load()
    state.launches.push({ ...assignment, at: new Date().toISOString() })
    this.save(state)
    return { runtime: 'local', session: assignment.session, ticketId: assignment.ticketId }
  }

  async deliver(input: Delivery): Promise<void> {
    const state = this.load()
    state.deliveries.push({ ...input, at: new Date().toISOString() })
    this.save(state)
  }

  load(): ExecutorLog {
    if (!existsSync(this.file)) return { launches: [], deliveries: [] }
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ExecutorLog>
    return {
      launches: parsed.launches ?? [],
      deliveries: parsed.deliveries ?? [],
    }
  }

  private save(state: ExecutorLog): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
  }
}

/**
 * 未设置根目录时与以前一样：抛出未接线错误，由分发器落招领。
 * 设置了根目录时构造克隆里的 DshExecutor，并确认它真的 enqueue 了对应 effect。
 */
export class DshExecutorAdapter implements ExecutorPort {
  readonly kind = 'dsh' as const
  readonly root: string | undefined
  readonly enqueued: DshEnqueue[] = []
  loadedFrom: string | undefined

  constructor(options: { root?: string } = {}) {
    const root = options.root?.trim()
    this.root = root || undefined
  }

  async start(assignment: ExecutorAssignment): Promise<ExecutorLaunch> {
    const planned = planDshStart(assignment)
    await this.invoke(planned, (executor) => {
      executor.start({ id: assignment.ticketId }, { id: assignment.assignmentId })
    }, assignment.assignmentId)
    return { runtime: 'dsh', session: planned.session, ticketId: assignment.ticketId }
  }

  async deliver(input: Delivery): Promise<void> {
    const planned = planDshDeliver(input)
    await this.invoke(planned, (executor) => {
      executor.deliver({ id: input.ticketId }, { id: input.ticketId })
    }, input.ticketId)
  }

  private async invoke(planned: DshCall, run: (executor: DshExecutorLike) => void, key: string): Promise<void> {
    if (!this.root) throw new DshNotWiredError(planned)
    let opened: Awaited<ReturnType<typeof openDshExecutor>>
    try {
      opened = await openDshExecutor(this.root)
      this.loadedFrom = opened.entry
      const before = opened.events.length
      run(opened.executor)
      const hit = opened.events.slice(before).find((event) => event.kind === planned.effect)
      assertEnqueue(hit, planned, key)
    } catch (error) {
      if (error instanceof DshNotWiredError) throw error
      throw new DshLoadError(planned, error)
    }
    this.enqueued.push({ ...planned, key })
  }
}

function assertEnqueue(hit: DshEnqueueEvent | undefined, planned: DshCall, key: string): void {
  if (!hit) throw new Error(`DshExecutor.${planned.method} 没有 enqueue('${planned.effect}')`)
  if (hit.key !== key) throw new Error(`enqueue 的 key 是 ${hit.key}，需要 ${key}`)
  if (hit.payload.ticketId !== planned.payload.ticketId) {
    throw new Error('enqueue 的 ticketId 与派工不一致')
  }
  if (planned.payload.assignmentId !== undefined && hit.payload.assignmentId !== planned.payload.assignmentId) {
    throw new Error('enqueue 的 assignmentId 与派工不一致')
  }
}

export function createExecutor(home: string, env: NodeJS.ProcessEnv = process.env): ExecutorPort {
  const requested = env.DAOGANG_EXECUTOR?.trim()
  const root = env.DAOGANG_DSH_ROOT?.trim() || undefined
  if (requested === 'local') return new LocalExecutor(join(home, 'executor.json'))
  if (requested === 'dsh' || root) return new DshExecutorAdapter({ root })
  return new LocalExecutor(join(home, 'executor.json'))
}
