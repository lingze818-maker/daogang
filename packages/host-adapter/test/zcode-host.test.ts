import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ZcodeHost } from '../src/zcode-host.ts'

// 用真 board.py（零依赖）在临时看板上跑集成形状；脚本不存在时整套跳过。
// 不在此探测性执行外部脚本（安全审查：避免动态命令面）；能力问题由用例自身的失败体现。
const SCRIPT = process.env.DAOGANG_BOARD_SCRIPT ?? 'D:/Users/那刻夏zcode/zcode-agent-board/agent-board/skills/agent-board/scripts/board.py'
const PYTHON = process.platform === 'win32' ? 'python' : 'python3'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const maybe = existsSync(SCRIPT) ? describe : describe.skip

maybe('ZcodeHost（E4 · agent-board 宿主）', () => {
  function host(): ZcodeHost {
    const root = mkdtempSync(join(tmpdir(), 'daogang-zcode-test-'))
    dirs.push(root)
    return new ZcodeHost({ script: SCRIPT, root, python: PYTHON })
  }

  it('auth：本地看板 anonymous', async () => {
    const auth = await host().auth()
    expect(auth.state).toBe('anonymous')
    expect(auth.detail).toContain('agent-board')
  })

  it('openSession 投任务到板上；sendMessage 留言；readContext 读回', async () => {
    const h = host()
    const session = await h.openSession({ kind: 'worker', ticketId: 'abcd1234', summary: '补安装文档' })
    expect(session.id).toBe('worker-abcd1234')
    const msg = await h.sendMessage({ sessionId: session.id, text: '优先补 pnpm install 一节' })
    expect(msg.text).toContain('pnpm')
    const ctx = await h.readContext(session.id)
    expect(ctx.text).toContain('abcd1234')
  })

  it('main 会话与无 ticketId 拒绝', async () => {
    await expect(host().openSession({ kind: 'main' })).rejects.toThrow(/worker/)
  })

  it('interrupt 走留言标注', async () => {
    const h = host()
    const session = await h.openSession({ kind: 'worker', ticketId: 'ffff0000', summary: '写文档' })
    const r = await h.interrupt({
      sessionId: session.id,
      incoming: { ticketId: 'eeee1111', summary: '紧急修 bug', urgency: 2, auditId: 'a-1' },
    })
    expect(r.handoffNote).toContain('打断')
    expect(r.nowSessionId).toBe('worker-eeee1111')
  })
})
