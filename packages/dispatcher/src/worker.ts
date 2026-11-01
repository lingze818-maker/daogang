import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { clampHandoff } from '@daogang/board'

export interface WorkerSlot {
  ticketId: string
  session: string
  auditId: string
  urgency: 0 | 1 | 2
  summary: string
}

export interface WorkerState {
  busy: WorkerSlot | null
  queue: WorkerSlot[]
}

export interface TaskAssignment {
  state: WorkerState
  /** 被更高优先级挤下去的那张工单。同级或更低不会挤。 */
  paused: WorkerSlot | null
  disposition: 'running' | 'queued'
  handoffNote: string
}

export function emptyWorkerState(): WorkerState {
  return { busy: null, queue: [] }
}

export function handoffFor(slot: WorkerSlot): string {
  return clampHandoff(`打断：先放下「${slot.summary}」（急 ${slot.urgency}）。`)
}

/**
 * 没有人在忙就直接上。
 * 新活更急：当前工单进队列，并留下交接备注；新活变成当前。
 * 新活不更急：新活排队，当前工单不动。
 */
export function assignTask(state: WorkerState, incoming: WorkerSlot): TaskAssignment {
  if (state.busy && incoming.urgency > state.busy.urgency) {
    const paused = state.busy
    return {
      state: { busy: incoming, queue: [...state.queue, paused] },
      paused,
      disposition: 'running',
      handoffNote: handoffFor(paused),
    }
  }
  if (state.busy) {
    return {
      state: { busy: state.busy, queue: [...state.queue, incoming] },
      paused: null,
      disposition: 'queued',
      handoffNote: '',
    }
  }
  return {
    state: { busy: incoming, queue: state.queue },
    paused: null,
    disposition: 'running',
    handoffNote: '',
  }
}

export class WorkerLane {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  load(): WorkerState {
    if (!existsSync(this.file)) return emptyWorkerState()
    const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WorkerState>
    return {
      busy: parsed.busy ?? null,
      queue: parsed.queue ?? [],
    }
  }

  save(state: WorkerState): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.file)
  }
}
