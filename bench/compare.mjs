#!/usr/bin/env node
// D2 对照表生成器：读 results-keywords.json 与 results-flash.json（后者由
//   DEEPSEEK_API_KEY=... node --experimental-strip-types bench/run-bench.mjs --router flash
// 产出），生成 bench/compare.md。flash 结果缺位时生成模板（占位待填）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const load = name => {
  const f = join(here, name)
  if (!existsSync(f)) return null
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null }
}
const kw = load('results-keywords.json')
const fl = load('results-flash.json')

const cell = (r, path) => {
  if (!r) return '—（待 flash 跑）'
  return path(r)
}
const pct = x => x.toFixed(3)

const groups = ['task', 'mixed', 'trap']
const lines = []
lines.push('# D2 · 关键词兜底 vs Flash 路由（同一数据集 100 条）')
lines.push('')
lines.push(`_keywords: ${kw ? kw.at : '—'} · flash: ${fl ? fl.at : '待跑（需 DEEPSEEK_API_KEY）'}_`)
if (fl?.via) lines.push(`_flash 实走 ${fl.via.flash} 条 / 回落关键词 ${fl.via.fallback_rules} 条（回落>0 时对照结论需注明）_`)
lines.push('')
lines.push('| 指标 | 关键词兜底 | Flash 路由 |')
lines.push('|---|---|---|')
for (const [label, key] of [['target 准确率（总体）', 'target_accuracy'], ['urgency 准确率（总体）', 'urgency_accuracy'], ['target+urgency（总体）', 'both_accuracy']]) {
  lines.push(`| ${label} | ${kw ? pct(kw[key]) : '—'} | ${cell(fl, r => pct(r[key]))} |`)
}
for (const g of groups) {
  lines.push(`| target 准确率（${g}） | ${kw ? `${pct(kw.by_group[g].target)} (n=${kw.by_group[g].n})` : '—'} | ${cell(fl, r => `${pct(r.by_group[g].target)} (n=${r.by_group[g].n})`)} |`)
}
lines.push('')
if (!fl) {
  lines.push('## 跑法（额度恢复后）')
  lines.push('')
  lines.push('```bash')
  lines.push('export DEEPSEEK_API_KEY=<key>')
  lines.push('node --experimental-strip-types bench/run-bench.mjs --router flash')
  lines.push('node --experimental-strip-types bench/compare.mjs   # 重新生成本表')
  lines.push('```')
  lines.push('')
  lines.push('焦点看 trap 组：关键词 0.15（D1 实测），Flash 若显著更高，"小模型路由+关键词兜底"双层设计即有数据支撑。')
} else {
  const delta = (fl.target_accuracy - kw.target_accuracy)
  lines.push(`## 判读`)
  lines.push('')
  lines.push(`- 总体 target：${kw ? pct(kw.target_accuracy) : '—'} → ${pct(fl.target_accuracy)}（${delta >= 0 ? '+' : ''}${pct(delta)}）`)
  lines.push(`- trap 组：${kw ? pct(kw.by_group.trap.target) : '—'} → ${pct(fl.by_group.trap.target)}——三层盲区（名词误触发/词表窄/祈使无呼语）被 Flash 解掉多少`)
  if (fl.via?.fallback_rules > 0) lines.push(`- ⚠️ 有 ${fl.via.fallback_rules} 条回落关键词（超时/非 JSON），对照解读需谨慎`)
}

writeFileSync(join(here, 'compare.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
