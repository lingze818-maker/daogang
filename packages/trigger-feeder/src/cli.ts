import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { InboxTrigger } from '@daogang/inbox-source'
import { startTriggerFeeder, type TriggerStoreLike } from './feeder.ts'

/**
 * feeder CLI：node packages/trigger-feeder/src/cli.ts
 *
 * 环境变量（与 dispatch 写侧同一 DAOGANG_HOME，路径字节级一致）：
 * - DAOGANG_HOME          triggers.jsonl 所在目录（默认 ./.daogang）
 * - DAOGANG_DSH_ROOT      dsh-superagent-prototype 克隆（加载公开 Store，动态 import 不入依赖）
 * - DAOGANG_FEEDER_DB     DSH 的 orchestrator.sqlite 路径；缺省取 ~/.dsh/state/superagent/orchestrator.sqlite
 *                         ——必须是运行中 DSH 的同一个库，写到别处没有意义
 * - DSH_API               DSH API 基址（默认 http://127.0.0.1:3082/orchestrator/api）
 * - DAOGANG_FEEDER_STATE  已投 id 落盘（默认 DAOGANG_HOME/feeder-state.json）
 *
 * 3082 没在跑时 feeder 照常尾文件；requeue 失败进重试队列，服务回来后自动补投
 * ——读侧代码常驻无害，不违反上课周三不动。SQLite WAL 支持双进程（DSH 进程 + feeder），
 * Store 构造的 migration 与 PRAGMA 均幂等。
 */

const DEFAULT_API = 'http://127.0.0.1:3082/orchestrator/api'

interface StoreModule {
  Store: new (path: string) => { triggers: { save(trigger: InboxTrigger): void } }
}

async function openStore(root: string): Promise<TriggerStoreLike> {
  const storeMod = (await import(pathToFileURL(join(root, 'src/app/store.ts')).href)) as StoreModule
  const dbPath = process.env.DAOGANG_FEEDER_DB
    ?? join(homedir(), '.dsh', 'state', 'superagent', 'orchestrator.sqlite')
  if (!existsSync(dbPath)) {
    throw new Error(`DSH 库不存在：${dbPath}（3082 起过一次才有；或用 DAOGANG_FEEDER_DB 指定）`)
  }
  console.log(`[feeder] Store 已开：${dbPath}`)
  const store = new storeMod.Store(dbPath)
  return { save: (trigger) => store.triggers.save(trigger) }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  // 上游 store.ts 用 TS 参数属性，Node 默认 strip-only 拒载：设了 DAOGANG_DSH_ROOT 必须用
  // node --experimental-transform-types src/cli.ts 启动（check-effects.mjs 同一约束）。
  const root = process.env.DAOGANG_DSH_ROOT
  if (root && !process.execArgv.includes('--experimental-transform-types')) {
    console.error('[feeder] 设了 DAOGANG_DSH_ROOT 时请用：node --experimental-transform-types packages/trigger-feeder/src/cli.ts')
    process.exitCode = 1
    return
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法：node --experimental-transform-types src/cli.ts\n环境变量见文件头注释。Ctrl-C 收班（state 落盘后退出）。')
    return
  }
  const home = process.env.DAOGANG_HOME ?? './.daogang'
  const logFile = join(home, 'triggers.jsonl')
  const api = (process.env.DSH_API ?? DEFAULT_API).replace(/\/$/, '')
  const stateFile = process.env.DAOGANG_FEEDER_STATE ?? join(home, 'feeder-state.json')

  let store: TriggerStoreLike
  if (root && existsSync(join(root, 'src/app/store.ts'))) {
    store = await openStore(root)
  } else {
    // 没有 DSH 克隆也能跑：写入段降级为直通（仅冒烟用）——正式部署必须设 DAOGANG_DSH_ROOT。
    console.log('[feeder] 未设 DAOGANG_DSH_ROOT：Store 写入段降级为直通（仅冒烟用）')
    store = { save: () => {} }
  }

  const controller = new AbortController()
  const feeder = startTriggerFeeder({
    logFile,
    signal: controller.signal,
    store,
    stateFile,
    requeue: async (id) => {
      // 同源管理请求约定：x-orchestrator-request: 1，无 Origin 头（上游 http.ts sameOrigin）。
      const response = await fetch(`${api}/triggers/${encodeURIComponent(id)}/requeue`, {
        method: 'POST',
        headers: { 'x-orchestrator-request': '1' },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as { queued?: boolean }
      return body.queued !== false
    },
    log: (message) => console.log(`[feeder] ${message}`),
  })
  console.log(`[feeder] 尾随 ${logFile}，requeue → ${api}`)

  const shutdown = (): void => {
    feeder.stop()
    controller.abort()
    const stats = feeder.stats()
    console.log(`[feeder] 收班 delivered=${stats.delivered} requeued=${stats.requeued} pending=${stats.pending}`)
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && process.argv[1].endsWith('cli.ts')) {
  void main()
}
