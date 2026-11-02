import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Board } from '@daogang/board'
import { handoffFor, LocalExecutor, replyOnMain, WorkerLane, workerSessionId } from '@daogang/dispatcher'
import { describe, expect, it } from 'vitest'
import {
  createHost,
  DuiyingHost,
  DuiyingLinkError,
  HostAdapterError,
  LocalCliHost,
} from '../src/index.ts'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'daogang-host-'))
}

describe('LocalCliHost', () => {
  it('sends the same main-window stub as the CLI', async () => {
    const host = new LocalCliHost(home())
    const at = '2026-11-01T12:00:00.000Z'
    const sent = await host.sendMessage({ sessionId: 'main', text: '谢谢', at })
    expect(sent).toEqual({
      sessionId: 'main',
      text: replyOnMain({ summary: '谢谢', at }).text,
      at,
    })
    expect(host.id).toBe('local-cli')
  })

  it('names a worker session and delivers on the local executor', async () => {
    const dir = home()
    const host = new LocalCliHost(dir)
    const opened = await host.openSession({ kind: 'worker', ticketId: 'abcd1234' })
    expect(opened).toEqual({ id: 'worker-abcd1234', kind: 'worker' })
    expect(workerSessionId('abcd1234')).toBe(opened.id)
    await host.sendMessage({ sessionId: opened.id, text: '续一句', at: '2026-11-01T12:00:00.000Z' })
    const stored = new LocalExecutor(join(dir, 'executor.json')).load()
    expect(stored.deliveries[0]?.text).toBe('续一句')
    expect(stored.launches).toEqual([])
  })

  it('interrupts only a busier session and keeps the handoff on the board', async () => {
    const dir = home()
    const host = new LocalCliHost(dir)
    const busy = {
      ticketId: 'aaaa1111',
      session: 'worker-aaaa1111',
      auditId: 'audit-busy',
      urgency: 1 as const,
      summary: '补上安装说明',
    }
    new WorkerLane(join(dir, 'worker.json')).save({ busy, queue: [] })
    new Board(join(dir, 'board.jsonl')).append({
      id: 'audit-busy',
      at: '2026-11-01T12:00:00.000Z',
      input: '帮我补上安装说明',
      target: 'worker',
      urgency: 1,
      cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
      via: 'rules',
      reason: '关键词',
      handoffNote: '',
      status: 'accepted',
      receipts: [{
        status: 'accepted',
        triggerId: 'inbox:m1:task',
        ticketId: 'aaaa1111',
        session: 'worker-aaaa1111',
        lane: 'task',
        disposition: 'running',
      }],
    })

    const same = host.interrupt({
      sessionId: busy.session,
      incoming: { ticketId: 'bbbb2222', summary: '稍后写', urgency: 1, auditId: 'audit-next' },
    })
    await expect(same).rejects.toBeInstanceOf(HostAdapterError)
    expect(new WorkerLane(join(dir, 'worker.json')).load().busy?.session).toBe(busy.session)

    const result = await host.interrupt({
      sessionId: busy.session,
      incoming: { ticketId: 'bbbb2222', summary: '马上修', urgency: 2, auditId: 'audit-next' },
    })
    expect(result.pausedSessionId).toBe(busy.session)
    expect(result.nowSessionId).toBe('worker-bbbb2222')
    expect(result.handoffNote).toBe(handoffFor(busy))
    expect(Array.from(result.handoffNote).length).toBeLessThanOrEqual(200)
    const state = new WorkerLane(join(dir, 'worker.json')).load()
    expect(state.busy?.session).toBe('worker-bbbb2222')
    expect(state.queue.map((item) => item.session)).toEqual([busy.session])
    expect(new Board(join(dir, 'board.jsonl')).list()[0]).toMatchObject({
      status: 'queued',
      handoffNote: result.handoffNote,
    })
    const context = await host.readContext(busy.session)
    expect(context.text).toBe('补上安装说明')
    expect(context.handoffNote).toBe(result.handoffNote)
    expect(new LocalExecutor(join(dir, 'executor.json')).load().launches).toHaveLength(1)
  })

  it('reports anonymous auth and does not invent a missing session', async () => {
    const host = new LocalCliHost(home())
    await expect(host.auth()).resolves.toMatchObject({ state: 'anonymous' })
    await expect(host.readContext('worker-missing')).rejects.toBeInstanceOf(HostAdapterError)
    await expect(host.openSession({ kind: 'worker' })).rejects.toBeInstanceOf(HostAdapterError)
  })
})

interface Hit {
  method: string
  url: string
  body: string
  headers: Record<string, string | string[] | undefined>
}

function listen(handler: (hits: Hit[]) => Server): Promise<{ baseUrl: string; hits: Hit[]; close: () => Promise<void> }> {
  const hits: Hit[] = []
  const server = handler(hits)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('测试服务器没有端口'))
        return
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        hits,
        close: () => new Promise((done, fail) => {
          server.close((error) => error ? fail(error) : done())
        }),
      })
    })
  })
}

describe('DuiyingHost', () => {
  it('stays unconfigured and fails health clearly when nothing is listening', async () => {
    const dir = home()
    const host = new DuiyingHost({ home: dir, env: {} })
    await expect(host.auth()).resolves.toMatchObject({ state: 'unconfigured' })
    const closed = await listen((hits) => createServer((_req, res) => {
      hits.push({ method: '', url: '', body: '', headers: {} })
      res.end()
    }))
    const port = new URL(closed.baseUrl).port
    await closed.close()
    const offline = new DuiyingHost({ home: dir, env: {}, baseUrl: `http://127.0.0.1:${port}` })
    const error = await offline.checkHealth().then(() => {
      throw new Error('应该连不上')
    }, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(DuiyingLinkError)
    expect((error as Error).message).toContain('连不上')
    expect((error as Error).message).toContain('/api/health')
    expect((error as Error).message).not.toMatch(/\/home\/|\/Users\/|workspace/)
    await expect(host.sendMessage({ sessionId: 'main', text: '你好' })).rejects.toThrow(/DAOGANG_DUIYING_SECRET/)
    await expect(host.proveWake()).rejects.toThrow(/DAOGANG_DUIYING_SECRET/)
    expect(() => new DuiyingHost({ home: dir, env: {}, baseUrl: 'http://example.com:8765' })).not.toThrow()
    await expect(new DuiyingHost({ home: dir, env: {}, baseUrl: 'http://example.com:8765' }).checkHealth())
      .rejects.toThrow(/loopback/)
  })

  it('runs the connectivity happy path on a fake loopback server without entering chat', async () => {
    const dir = home()
    const secret = 'loopback-secret'
    const fake = await listen((hits) => createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const hit: Hit = {
          method: req.method ?? '',
          url: req.url ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
          headers: req.headers,
        }
        hits.push(hit)
        if (req.method === 'GET' && req.url === '/api/health') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
          return
        }
        if (req.method === 'POST' && req.url === '/api/wake') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ blocks: ['should-not-leak-into-context'] }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    }))
    const host = new DuiyingHost({ home: dir, baseUrl: fake.baseUrl, env: { DAOGANG_DUIYING_SECRET: secret } })
    try {
      expect((await host.checkHealth()).status).toBe(200)
      const auth = await host.auth()
      expect(auth.state).toBe('anonymous')
      expect(auth.detail).not.toContain(secret)
      const opened = await host.openSession({
        kind: 'worker',
        ticketId: 'abcd1234',
        summary: '补上安装说明',
        peerId: 'peer-fixture',
        channel: 'im',
      })
      expect(opened).toEqual({ id: 'worker-abcd1234', kind: 'worker' })
      expect((await host.proveWake()).status).toBe(200)
      const context = await host.readContext(opened.id)
      expect(context).toMatchObject({
        sessionId: 'worker-abcd1234',
        text: '补上安装说明',
        handoffNote: '',
        mode: 'dev',
      })
      expect(JSON.stringify(context)).not.toContain('peer-fixture')
      expect(JSON.stringify(context)).not.toContain('should-not-leak-into-context')
      expect(JSON.stringify(context)).not.toContain(secret)

      const busy = {
        ticketId: 'abcd1234',
        session: 'worker-abcd1234',
        auditId: 'audit-busy',
        urgency: 1 as const,
        summary: '补上安装说明',
      }
      new WorkerLane(join(dir, 'worker.json')).save({ busy, queue: [] })
      new Board(join(dir, 'board.jsonl')).append({
        id: 'audit-busy',
        at: '2026-11-01T12:00:00.000Z',
        input: '帮我补上安装说明',
        target: 'worker',
        urgency: 1,
        cards: [{ role: 'docs', kind: 'task', summary: '补上安装说明' }],
        via: 'rules',
        reason: '关键词',
        handoffNote: '',
        status: 'accepted',
        receipts: [{
          status: 'accepted',
          triggerId: 'inbox:m1:task',
          ticketId: 'abcd1234',
          session: 'worker-abcd1234',
          lane: 'task',
          disposition: 'running',
        }],
      })
      const turned = await host.interrupt({
        sessionId: busy.session,
        incoming: { ticketId: 'bbbb2222', summary: '马上修', urgency: 2, auditId: 'audit-next' },
      })
      expect(turned.nowSessionId).toBe('worker-bbbb2222')
      expect(turned.handoffNote).toBe(handoffFor(busy))
      expect(new Board(join(dir, 'board.jsonl')).list()[0]).toMatchObject({
        status: 'queued',
        handoffNote: turned.handoffNote,
      })
      const next = await host.readContext(turned.nowSessionId)
      expect(next.text).toBe('马上修')
      expect(next.mode).toBe('dev')
      const paused = await host.readContext(busy.session)
      expect(paused.handoffNote).toBe(turned.handoffNote)
      expect(paused.text).toBe('补上安装说明')
      expect(JSON.stringify(paused)).not.toContain('peer-fixture')

      const paths = fake.hits.map((hit) => `${hit.method} ${hit.url}`)
      expect(paths).toEqual(['GET /api/health', 'POST /api/wake'])
      const wake = JSON.parse(fake.hits[1]?.body ?? '{}') as { mode?: string; text?: string; skip_memory?: boolean }
      expect(wake).toEqual({ mode: 'dev', text: '连通', skip_memory: true })
      expect(JSON.stringify(fake.hits)).not.toContain(secret)
      expect(JSON.stringify(fake.hits)).not.toContain('peer-fixture')
      const map = readFileSync(join(dir, 'duiying-map.json'), 'utf8')
      expect(map).toContain('worker-bbbb2222')
      expect(map).not.toContain('/home/')
    } finally {
      await fake.close()
    }
  })

  it('accepts the daogang-local secret file and still fails closed without a server', async () => {
    const dir = home()
    writeFileSync(join(dir, 'duiying.local.json'), `${JSON.stringify({ secret: 'file-secret' })}\n`)
    // 指向一个必然拒连的地址（loopback 保留端口），不依赖本机是否恰好在跑对影
    const host = new DuiyingHost({ home: dir, env: { DAOGANG_DUIYING_BASE_URL: 'http://127.0.0.1:1' } })
    const auth = await host.auth()
    expect(auth.state).toBe('anonymous')
    expect(auth.detail).not.toContain('file-secret')
    await host.openSession({ kind: 'worker', ticketId: 'abcd1234' })
    await expect(host.sendMessage({ sessionId: 'worker-abcd1234', text: '一句' })).rejects.toThrow(/\/api\/daogang\/inject/)
  })
})

describe('createHost', () => {
  it('defaults to the local CLI host', () => {
    const dir = home()
    expect(createHost({ home: dir }).id).toBe('local-cli')
    expect(createHost({ kind: 'duiying', home: dir, env: {} }).id).toBe('duiying')
    expect(() => createHost()).toThrow(HostAdapterError)
    expect(() => createHost({ kind: 'duiying' })).toThrow(HostAdapterError)
  })
})
