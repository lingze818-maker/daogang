import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { watchTriggerLog } from '@daogang/inbox-source'
import type { InboxTrigger } from '@daogang/inbox-source'

/**
 * triggers.jsonl 读侧（issue #34 三段组合，鎏涟 2026-11-09 定案）：
 * #43 移除 plugin 入口后，桥只剩写侧——本包把新行喂进运行中的 DSH：
 * ①公开 Store 写入（triggers.save，纯增量，不碰上游内核）
 * ②POST triggers/:id/requeue 让 assessment 重新吃
 * 写入或 requeue 失败进重试队列（DSH 没在跑时不丢：服务回来后补投）。
 * 已投 id 落盘 stateFile，feeder 重启续读不重投。
 */

/** 投递侧可写 Store 的最小面（上游 Store.triggers 的子集，测试用假件）。 */
export interface TriggerStoreLike {
  save(trigger: InboxTrigger): void
}

export interface FeederStats {
  delivered: number
  requeued: number
  pending: number
  failed: number
}

export interface FeederOptions {
  logFile: string
  signal: AbortSignal
  /** 公开 Store 写入段。 */
  store: TriggerStoreLike
  /** requeue 段：解析为 queued；reject/throw 视为暂不可投。 */
  requeue: (id: string) => Promise<boolean>
  /** 已投 id 落盘路径（JSON 数组）。缺省不落盘（仅内存去重）。 */
  stateFile?: string
  intervalMs?: number
  /** 重试间隔毫秒，默认 2000。 */
  retryMs?: number
  /** 状态行数上限：超过裁掉最旧一半（桥是热数据，无长回放价值）。 */
  stateMax?: number
  log?: (message: string) => void
}

interface PendingItem {
  trigger: InboxTrigger
  saved: boolean
  attempts: number
}

function loadSeen(stateFile?: string): Set<string> {
  if (!stateFile || !existsSync(stateFile)) return new Set()
  try {
    const parsed: unknown = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function startTriggerFeeder(options: FeederOptions): { stop(): void; stats(): FeederStats } {
  const {
    logFile, signal, store, requeue, stateFile,
    intervalMs, retryMs = 2000, stateMax = 2000,
    log = () => {},
  } = options

  const seen = loadSeen(stateFile)
  const pending: PendingItem[] = []
  const stats: FeederStats = { delivered: 0, requeued: 0, pending: 0, failed: 0 }
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const persist = (): void => {
    if (!stateFile || stopped) return
    if (persistTimer) return
    // 聚合 250ms 内的多次落盘；feeder 挂掉丢最近一条的落盘可接受（重启后 seen 缺失会重投一条，下游按 id 幂等）。
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      try {
        let ids = [...seen]
        if (ids.length > stateMax) ids = ids.slice(ids.length - Math.floor(stateMax / 2))
        writeFileSync(stateFile, `${JSON.stringify(ids)}\n`, 'utf8')
      } catch (error) {
        log(`state 落盘失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }, 250)
  }

  const drain = (): void => {
    const remaining: PendingItem[] = []
    for (const item of pending) {
      try {
        if (!item.saved) {
          store.save(item.trigger)
          item.saved = true
          stats.delivered += 1
        }
        const queued = requeue(item.trigger.id)
        if (queued instanceof Promise) {
          remaining.push(item)
          void queued.then((ok) => {
            finish(item, ok !== false)
          }).catch(() => {
            item.attempts += 1
            stats.failed += 1
            log(`requeue 失败（将重试）：${item.trigger.id}`)
          })
        } else {
          finish(item, queued !== false)
        }
      } catch (error) {
        item.attempts += 1
        stats.failed += 1
        remaining.push(item)
        log(`投递失败（将重试）：${item.trigger.id} ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    pending.length = 0
    pending.push(...remaining)
    stats.pending = pending.length
    scheduleRetry()
  }

  const finish = (item: PendingItem, ok: boolean): void => {
    const index = pending.indexOf(item)
    if (index >= 0) pending.splice(index, 1)
    if (ok) {
      stats.requeued += 1
      seen.add(item.trigger.id)
      persist()
    } else {
      stats.failed += 1
    }
    stats.pending = pending.length
  }

  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleRetry = (): void => {
    if (stopped || pending.length === 0 || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      drain()
    }, retryMs)
  }

  const stop = watchTriggerLog(logFile, (trigger) => {
    if (stopped) return
    pending.push({ trigger, saved: false, attempts: 0 })
    drain()
  }, signal, { intervalMs, seen })

  return {
    stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = undefined
      // 收班前尽力落盘一次
      try {
        if (stateFile) writeFileSync(stateFile, `${JSON.stringify([...seen].slice(-stateMax))}\n`, 'utf8')
      } catch { /* 收班落盘失败不抛 */ }
      stop()
    },
    stats: () => ({ ...stats, pending: pending.length }),
  }
}
