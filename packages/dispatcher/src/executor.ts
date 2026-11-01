import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 会话执行口。默认 LocalExecutor。
 * DshExecutorAdapter 不 import `@deepseek-ai/dsh-*`。
 * 上游形状见 dsh-superagent-prototype `src/executor/dsh.ts`：
 * `start` → `effects.enqueue('launch', assignmentId, { ticketId, assignmentId })`
 * `deliver` → `effects.enqueue('delivery', ticketId, { ticketId })`
 * 会话名是 `worker-${ticketId}`。
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
    super(`DSH 未接线：${call.method} 会 enqueue('${call.effect}')。未安装 @deepseek-ai/dsh-*`)
    this.name = 'DshNotWiredError'
    this.call = call
  }
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

/** 骨架。方法体只算出上游调用点，然后拒绝执行。 */
export class DshExecutorAdapter implements ExecutorPort {
  readonly kind = 'dsh' as const

  async start(assignment: ExecutorAssignment): Promise<ExecutorLaunch> {
    throw new DshNotWiredError(planDshStart(assignment))
  }

  async deliver(input: Delivery): Promise<void> {
    throw new DshNotWiredError(planDshDeliver(input))
  }
}

export function createExecutor(home: string, env: NodeJS.ProcessEnv = process.env): ExecutorPort {
  if (env.DAOGANG_EXECUTOR?.trim() === 'dsh') return new DshExecutorAdapter()
  return new LocalExecutor(join(home, 'executor.json'))
}
