#!/usr/bin/env node
// D1 mini-bench runner：对 bench/dataset.jsonl 跑关键词兜底路由，出准确率与错例。
// 无密钥、无网络。Flash 路由对照（D2）后续加 --router flash。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { routeByRules } = await import(pathToFileURL(join(here, '..', 'packages', 'dispatcher', 'src', 'rules.ts')).href)

const rows = readFileSync(join(here, 'dataset.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))

const results = []
let okTarget = 0, okUrgency = 0, okBoth = 0
const byGroup = {}
for (const row of rows) {
  const { decision } = routeByRules(row.text)
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
  results.push({ ...row, got_target: decision.target, got_urgency: decision.urgency, hitTarget, hitUrgency })
}

const total = rows.length
const summary = {
  router: 'keywords',
  at: new Date().toISOString(),
  total,
  target_accuracy: +(okTarget / total).toFixed(3),
  urgency_accuracy: +(okUrgency / total).toFixed(3),
  both_accuracy: +(okBoth / total).toFixed(3),
  by_group: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, {
    n: v.n,
    target: +(v.target / v.n).toFixed(3),
    urgency: +(v.urgency / v.n).toFixed(3),
    both: +(v.both / v.n).toFixed(3),
  }])),
  misses: results.filter(r => !(r.hitTarget && r.hitUrgency)).map(r => ({
    id: r.id, group: r.group, text: r.text,
    expect: `${r.expect_target}/${r.expect_urgency}`, got: `${r.got_target}/${r.got_urgency}`,
  })),
}

writeFileSync(join(here, 'results-keywords.json'), JSON.stringify(summary, null, 2))
writeFileSync(join(here, 'results-keywords-all.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(JSON.stringify({ ...summary, misses: `${summary.misses.length} 条（详见 results-keywords.json）` }, null, 2))
