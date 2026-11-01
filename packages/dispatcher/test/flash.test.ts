import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFlashRouter } from '../src/flash.ts'
import { loadEnvFile } from '../src/env.ts'
import { routeText } from '../src/route.ts'

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
}

describe('flash router', () => {
  it('returns null when no key is configured', async () => {
    const router = createFlashRouter({})
    expect(await router.route('你好')).toBeNull()
  })

  it('parses a JSON body and treats HTTP or network failure as unavailable', async () => {
    const key = 'test-key-not-real'
    const ok = createFlashRouter({ DEEPSEEK_API_KEY: key }, async () => jsonResponse('{"target":"main","urgency":1,"cards":[{"role":"main","kind":"chat","summary":"你好"}]}'))
    expect(await ok.route('你好')).toMatchObject({ target: 'main' })

    const fenced = createFlashRouter(
      { DEEPSEEK_API_KEY: key },
      async () => jsonResponse('```json\n{"target":"worker","urgency":1,"cards":[{"role":"worker","kind":"task","summary":"补上"}]}\n```'),
    )
    expect(await fenced.route('帮我')).toMatchObject({ target: 'worker' })

    const http = createFlashRouter({ DEEPSEEK_API_KEY: key }, async () => jsonResponse('nope', 500))
    expect(await http.route('帮我')).toBeNull()

    const down = createFlashRouter({ DEEPSEEK_API_KEY: key }, async () => {
      throw new Error(`network down authorization Bearer ${key}`)
    })
    expect(await down.route('帮我')).toBeNull()
  })

  it('falls back to keywords when flash returns nothing', async () => {
    const routed = await routeText('帮我补上安装说明', { async route() { return null } })
    expect(routed.via).toBe('rules')
    expect(routed.decision.target).toBe('worker')
  })

  it('does not override variables already set in the environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daogang-env-'))
    writeFileSync(join(dir, '.env'), 'DEEPSEEK_API_KEY=from-file\nDAOGANG_FLASH_MODEL=deepseek-flash\n# comment\n')
    const env: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'already' }
    loadEnvFile(dir, env)
    expect(env.DEEPSEEK_API_KEY).toBe('already')
    expect(env.DAOGANG_FLASH_MODEL).toBe('deepseek-flash')
    expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain('already')
  })
})
