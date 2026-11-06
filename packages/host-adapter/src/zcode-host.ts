import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HostAdapterError,
} from './adapter.ts'
import type {
  HostAdapter,
  HostAuth,
  HostContext,
  HostMessage,
  HostSession,
  InterruptInput,
  InterruptResult,
  OpenSessionInput,
  SendMessageInput,
} from './adapter.ts'

/**
 * E4 · zcode 宿主适配器（灵泽 2026-11-01 宿主序：对影 > zcode > Codex）。
 *
 * zcode 是 Electron 桌面应用，没有 headless CLI；它的跨对话协作面是
 * agent-board（文件型任务看板，claim/done 原子锁）。本适配器把任务腿
 * 投到 agent-board，由 zcode 里的窗口/班次（如构件轮）开工认领执行——
 * 「派单」与「执行」异步解耦，正是招领哲学的宿主版。
 *
 * 协议兼容方式：spawn agent-board 的 board.py（零第三方依赖）而不是
 * 重写文件协议——add/claim/done 的原子性交给正主。zcode 侧用同一块板
 * （--root 指向项目根），双向都看得见。
 *
 * 会话模型：一次 openSession(worker) = board 上一个任务（标题带 ticketId，
 * 认领身份 `daogang`）。sendMessage = 任务留言。interrupt 用留言标注，
 * 不动锁——板上的接管/超时规则由 board 自己管。
 */
export interface ZcodeHostOptions {
  /** board.py 的绝对路径。 */
  script: string
  /** 看板所在项目根（含 .agent-board/）。默认临时目录（测试用）。 */
  root?: string
  /** 看板身份。默认 `daogang`。 */
  agent?: string
  /** python 可执行名。默认 `python3`。 */
  python?: string
}

interface BoardTask {
  id: string
  title: string
  status: string
  result?: string
}

export class ZcodeHost implements HostAdapter {
  readonly id = 'zcode' as const

  private readonly script: string
  private readonly root: string
  private readonly agent: string
  private readonly python: string

  constructor(options: ZcodeHostOptions) {
    this.script = options.script
    this.root = options.root ?? mkdtempSync(join(tmpdir(), 'daogang-zcode-'))
    this.agent = options.agent ?? 'daogang'
    this.python = options.python ?? 'python3'
  }

  private async run(args: string[]): Promise<string> {
    return await new Promise((resolve, reject) => {
      const child = spawn(this.python, [this.script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AGENT_BOARD_ROOT: this.root, AGENT_BOARD_AGENT: this.agent },
      })
      let out = ''
      let err = ''
      child.stdout.on('data', chunk => { out += chunk })
      child.stderr.on('data', chunk => { err += chunk })
      child.on('error', error => reject(new HostAdapterError(`zcode 看板脚本无法运行：${String(error)}`)))
      child.on('close', code => {
        if (code === 0) resolve(out)
        else reject(new HostAdapterError(`zcode 看板命令失败（exit ${code}）：${err.trim() || out.trim()}`))
      })
    })
  }

  private static ticketOf(sessionId: string): string {
    // 会话名形如 worker-<ticketId>
    if (!sessionId.startsWith('worker-')) throw new HostAdapterError(`zcode 宿主只投 worker 会话：${sessionId}`)
    return sessionId.slice('worker-'.length)
  }

  private async taskByTicket(ticketId: string): Promise<BoardTask> {
    const raw = await this.run(['list', '--all', '--json'])
    const tasks = JSON.parse(raw) as BoardTask[]
    const found = tasks.find(task => task.title.includes(`[${ticketId}]`))
    if (!found) throw new HostAdapterError(`看板上没有工单 ${ticketId} 的任务`)
    return found
  }

  async auth(): Promise<HostAuth> {
    // 看板是本地文件，没有要登的账号；脚本在就能用。
    try {
      await this.run(['whoami'])
      return { state: 'anonymous', detail: 'agent-board 本地看板' }
    } catch (error) {
      return { state: 'unconfigured', detail: String(error instanceof Error ? error.message : error) }
    }
  }

  async openSession(input: OpenSessionInput): Promise<HostSession> {
    if (input.kind !== 'worker' || !input.ticketId) {
      throw new HostAdapterError('zcode 宿主只接收 worker 会话；主窗在分发器本地')
    }
    const title = `[${input.ticketId}] ${input.summary ?? '到岗工单'}`
    const out = await this.run(['add', title, '-d', '来自到岗分发器的工单。认领后按工单卡片执行，完成把结果摘要写回。'])
    const id = (out.match(/T-\d+/) ?? [])[0]
    if (!id) throw new HostAdapterError(`看板没有返回任务号：${out.trim()}`)
    return { id: `worker-${input.ticketId}`, kind: 'worker' }
  }

  async sendMessage(input: SendMessageInput): Promise<HostMessage> {
    const ticketId = ZcodeHost.ticketOf(input.sessionId)
    const task = await this.taskByTicket(ticketId)
    await this.run(['comment', task.id, input.text.slice(0, 500)])
    return { sessionId: input.sessionId, text: input.text, at: input.at ?? new Date().toISOString() }
  }

  async interrupt(input: InterruptInput): Promise<InterruptResult> {
    // 板上不打断：留言标注，让认领方自己看到新急单。交接备注随留言走。
    const ticketId = ZcodeHost.ticketOf(input.sessionId)
    const task = await this.taskByTicket(ticketId)
    const note = `【打断】急 ${input.incoming.urgency}：${input.incoming.summary}（先放下，见新任务）`
    await this.run(['comment', task.id, note.slice(0, 200)])
    return { pausedSessionId: input.sessionId, handoffNote: note, nowSessionId: `worker-${input.incoming.ticketId}` }
  }

  async readContext(sessionId: string): Promise<HostContext> {
    const ticketId = ZcodeHost.ticketOf(sessionId)
    const task = await this.taskByTicket(ticketId)
    return {
      sessionId,
      text: task.result ?? task.title,
      handoffNote: '',
    }
  }
}
