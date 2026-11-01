import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DuiyingHost,
  DuiyingLinkError,
  HostAdapterError,
  startDuiyingUserHook,
} from '../src/index.ts'

function home(): string {
  return mkdtempSync(join(tmpdir(), 'daogang-inject-'))
}

describe('DuiyingHost inject and user hook', () => {
  it('injects into a mock window, stores dg- delivery_key, and refuses chat', async () => {
    const dir = home()
    const secret = 'loopback-secret'
    const hits: { url: string; body: string; secretHeader?: string }[] = []
    let injects = 0
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const url = req.url ?? ''
        const body = Buffer.concat(chunks).toString('utf8')
        const header = req.headers['x-daogang-secret']
        hits.push({ url, body, secretHeader: Array.isArray(header) ? header[0] : header })
        if (url === '/api/chat') {
          res.writeHead(500)
          res.end()
          return
        }
        if (req.method === 'POST' && url === '/api/daogang/inject') {
          injects += 1
          if (header !== secret) {
            res.writeHead(401)
            res.end('{"error":"unauthorized"}')
            return
          }
          if (injects === 1) {
            res.writeHead(503)
            res.end('{"error":"disabled"}')
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            delivery_key: 'dg-window',
            text: '窗内一句',
            at: '2026-11-01T00:00:00.000Z',
            sessionId: 'should-not-be-used',
          }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('mock 没有端口')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const host = new DuiyingHost({ home: dir, baseUrl, env: { DAOGANG_DUIYING_SECRET: secret } })
    try {
      await host.openSession({ kind: 'worker', ticketId: 'abcd1234', mode: 'companion', summary: '安装说明' })
      const disabled = await host.sendMessage({ sessionId: 'worker-abcd1234', text: '先试一次' }).then(() => {
        throw new Error('503 应该失败')
      }, (caught: unknown) => caught)
      expect(disabled).toBeInstanceOf(DuiyingLinkError)
      expect((disabled as Error).message).toContain('503')
      expect(readFileSync(join(dir, 'duiying-map.json'), 'utf8')).toContain('"deliveryKey":"worker-abcd1234"')

      const sent = await host.sendMessage({ sessionId: 'worker-abcd1234', text: '窗内交代' })
      expect(sent).toEqual({
        sessionId: 'worker-abcd1234',
        text: '窗内一句',
        at: '2026-11-01T00:00:00.000Z',
      })
      const again = await host.sendMessage({ sessionId: 'worker-abcd1234', text: '再一句' })
      expect(again.sessionId).toBe('worker-abcd1234')
      const bodies = hits.filter((hit) => hit.url === '/api/daogang/inject').map((hit) => JSON.parse(hit.body) as Record<string, string>)
      expect(bodies[1]).toEqual({ text: '窗内交代', worker_ref: 'worker-abcd1234', mode: 'companion' })
      expect(bodies[2]).toMatchObject({ delivery_key: 'dg-window', worker_ref: 'worker-abcd1234', mode: 'companion' })
      expect(hits.every((hit) => hit.url !== '/api/chat')).toBe(true)
      expect(hits.filter((hit) => hit.url === '/api/daogang/inject').every((hit) => hit.secretHeader === secret)).toBe(true)
      const context = await host.readContext('worker-abcd1234')
      expect(context.text).toBe('安装说明')
      expect(JSON.stringify(context)).not.toContain('dg-window')

      const wrong = new DuiyingHost({ home: dir, baseUrl, env: { DAOGANG_DUIYING_SECRET: 'other-secret' } })
      await expect(wrong.sendMessage({ sessionId: 'worker-abcd1234', text: '一句' })).rejects.toThrow(/401/)
      const bare = new DuiyingHost({ home: dir, baseUrl, env: {} })
      await expect(bare.sendMessage({ sessionId: 'worker-abcd1234', text: '一句' })).rejects.toThrow(/DAOGANG_DUIYING_SECRET/)
      expect(hits.filter((hit) => hit.secretHeader === undefined && hit.url === '/api/daogang/inject')).toHaveLength(0)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('accepts a secret user line on the loopback hook and dispatches it', async () => {
    const dir = home()
    const secret = 'loopback-secret'
    const host = new DuiyingHost({ home: dir, env: { DAOGANG_DUIYING_SECRET: secret } })
    await expect(host.startUserHook({ port: 0 })).rejects.toBeInstanceOf(HostAdapterError)
    await host.openSession({ kind: 'worker', ticketId: 'abcd1234', summary: '安装说明' })
    const mapFile = join(dir, 'duiying-map.json')
    const map = JSON.parse(readFileSync(mapFile, 'utf8')) as { sessions: Record<string, { deliveryKey: string }> }
    const binding = map.sessions['worker-abcd1234']
    if (!binding) throw new Error('映射没写上')
    binding.deliveryKey = 'dg-route'
    writeFileSync(mapFile, `${JSON.stringify(map)}\n`)

    const hook = await startDuiyingUserHook({ home: dir, secret, hook: true, port: 0, env: {} })
    try {
      const ok = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Daogang-Secret': secret },
        body: JSON.stringify({
          role: 'user',
          text: '帮我补上安装说明',
          mode: 'dev',
          delivery_key: 'dg-route',
          peer: 'peer-fixture',
          memory: 'do-not-store',
          path: '/tmp/private-dir',
        }),
      })
      expect(ok.status).toBe(200)
      const denied = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Daogang-Secret': 'wrong-secret' },
        body: JSON.stringify({ role: 'user', text: '不要收下', mode: 'dev', delivery_key: 'dg-route' }),
      })
      expect(denied.status).toBe(401)
      const missing = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', text: '没有头', mode: 'dev' }),
      })
      expect(missing.status).toBe(401)
      const context = await host.readContext('worker-abcd1234')
      expect(context.lastLine).toEqual({ role: 'user', text: '帮我补上安装说明' })
      expect(context.text).toBe('安装说明')
      const stored = readFileSync(mapFile, 'utf8')
      expect(stored).not.toContain('peer-fixture')
      expect(stored).not.toContain('do-not-store')
      expect(stored).not.toContain('/tmp/private-dir')
      expect(stored).not.toContain(secret)
      const board = readFileSync(join(dir, 'board.jsonl'), 'utf8')
      expect(board).toContain('帮我补上安装说明')
      expect(board).not.toContain('不要收下')
      expect(board).not.toContain('peer-fixture')
    } finally {
      await hook.close()
    }
  })
})
