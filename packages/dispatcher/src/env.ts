import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readFailLane(env: NodeJS.ProcessEnv = process.env): 'chat' | 'task' | undefined {
  const value = env.DAOGANG_FAIL_LANE?.trim()
  if (value === 'chat' || value === 'task') return value
  return undefined
}

/** 读取 `.env`。已存在的环境变量不覆盖。不打印值。 */
export function loadEnvFile(dir: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = join(dir, '.env')
  if (!existsSync(file)) return
  const text = readFileSync(file, 'utf8')
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
}
