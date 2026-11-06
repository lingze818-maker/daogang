#!/usr/bin/env node
/**
 * tsc 的 rewriteRelativeImportExtensions 会改 .js，但 .d.ts 仍写着 .ts。
 * 声明文件改成 .js，类型解析才找得到旁边的 .d.ts。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = new URL('../packages/inbox-source/lib/', import.meta.url)
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.d.ts')) continue
  const file = join(fileURLToPath(dir), name)
  const source = readFileSync(file, 'utf8')
  const next = source.replaceAll(/from (['"])(\.[^'"]+)\.ts\1/g, 'from $1$2.js$1')
  if (/from (['"])\.[^'"]+\.ts\1/.test(next)) {
    throw new Error(`${name} still imports a .ts specifier`)
  }
  writeFileSync(file, next)
}
