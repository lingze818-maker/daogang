#!/usr/bin/env node
// D1/D2 mini-bench runner：对 bench/dataset.jsonl 出路由准确率与错例。
// 默认关键词兜底（无密钥无网络）；--router flash 时逐条走 Flash 路由（需 DEEPSEEK_API_KEY，
// 缺 key 直接报错退出——对照跑必须知道每条走的哪条路，静默回落会污染数据）。
// 产物：results-keywords.json / results-flash.json + 同名 -all.jsonl；对照表见 compare.mjs。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = p => pathToFileURL(join(here, '..', 'packages', 'dispatcher', 'src', p)).href
const { routeByRules } = await import(pkg('rules.ts'))

const routerName = process.argv.includes('--router') ? process.argv[process.argv.indexOf('--router') + 1] : 'keywords'
if (routerName !== 'keywords' && routerName !== 'flash') {
  console.error(`未知 router：${routerName}（可用：keywords | flash）`)
  process.exit(2)
}
let routeText = null
if (routerName === 'flash') {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    console.error('flash 模式需要 DEEPSEEK_API_KEY（对照跑不接受静默回落）')
    process.exit(2)
  }
  ;({ routeText } = await import(pkg('route.ts')))
}
const flashRouter = routerName === 'flash'
  ? (await import(pkg('flash.ts'))).createFlashRouter(process.env) : null

const rows = readFileSync(join(here, 'dataset.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))

const results = []
let okTarget = 0, okUrgency = 0, okBoth = 0
const byGroup = {}
for (const [i, row] of rows.entries()) {
  let decision, via = 'rules'
  if (routerName === 'flash') {
    const r = await routeText(row.text, flashRouter)
    decision = r.decision
    via = r.via
    if ((i + 1) % 10 === 0) process.stderr.write(`flash ${i + 1}/${rows.length}…\n`)
  } else {
    decision = routeByRules(row.text).decision
  }
  const hitTarget = decision.target === row.expect_target
  const hitUrgency = decision.urgency === row.expect_urgency
  if (hitTarget) okTarget++
  if (hitUrgency) okUrgency++
  if (hitTarget && hitUrgency) okBoth++
  const g = byGroup[row.group] ??= { n: 0, target: 0, urgency: 0, both: 0 }
  g.n++
  if (hitTarget) g.target++
  if (hitUrgency) g.urgency++
  if (hitTarget && hitUrgency) g.both++
  results.push({ ...row, got_target: decision.target, got_urgency: decision.urgency, hitTarget, hitUrgency, via })
}

const total = rows.length
const summary = {
  router: routerName,
  at: new Date().toISOString(),
  total,
  target_accuracy: +(okTarget / total).toFixed(3),
  urgency_accuracy: +(okUrgency / total).toFixed(3),
  both_accuracy: +(okBoth / total).toFixed(3),
  via: routerName === 'flash'
    ? { flash: results.filter(r => r.via === 'flash').length, fallback_rules: results.filter(r => r.via === 'rules').length }
    : undefined,
  by_group: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, {
    n: v.n,
    target: +(v.target / v.n).toFixed(3),
    urgency: +(v.urgency / v.n).toFixed(3),
    both: +(v.both / v.n).toFixed(3),
  }])),
  misses: results.filter(r => !(r.hitTarget && r.hitUrgency)).map(r => ({
    id: r.id, group: r.group, text: r.text, via: r.via,
    expect: `${r.expect_target}/${r.expect_urgency}`, got: `${r.got_target}/${r.got_urgency}`,
  })),
}

writeFileSync(join(here, `results-${routerName}.json`), JSON.stringify(summary, null, 2))
writeFileSync(join(here, `results-${routerName}-all.jsonl`), results.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(JSON.stringify({ ...summary, misses: `${summary.misses.length} 条（详见 results-${routerName}.json）` }, null, 2))
