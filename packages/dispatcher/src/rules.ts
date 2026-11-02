import type { Card, Decision, Target, Urgency } from '@daogang/inbox-source'
import { clampText, collapseSpace } from './text.ts'

const CHAT: RegExp[] = [
  /你好/,
  /在吗/,
  /谢谢/,
  /感谢/,
  /哈哈/,
  /闲聊/,
  /怎么样/,
  /晚安/,
  /早安/,
  /\bhello\b/i,
  /\bhi\b/i,
  /\bthanks\b/i,
]

const TASK: RegExp[] = [
  /帮我/,
  /帮忙/,
  /改一下/,
  /修一下/,
  /实现/,
  /排查/,
  /写成/,
  /补上/,
  /修复/,
  /任务/,
  /文档/,
  /安装/,
  /\bfix\b/i,
  /\bimplement\b/i,
  /\bbug\b/i,
  /\breadme\b/i,
]

const URGENT: RegExp[] = [
  /马上/,
  /立刻/,
  /紧急/,
  /现在就/,
  /尽快/,
  /打断/,
  /\basap\b/i,
  /\burgent\b/i,
]

const LATER: RegExp[] = [
  /不急/,
  /不着急/,
  /有空再/,
  /稍后/,
  /下次/,
  /\blater\b/i,
  /\bwhenever\b/i,
]

/** 夹在闲聊和任务之间的节奏词，拆句时跟任务走。 */
const URGENCY_TAIL = /[，,、；;\s]*(?:马上|立刻|紧急|现在就|尽快|打断|不急|不着急|有空再|稍后|下次|asap|urgent|later|whenever)$/i

const ROLE_HINTS: { role: string; pattern: RegExp }[] = [
  { role: 'docs', pattern: /文档|readme|说明|安装/i },
  { role: 'fix', pattern: /修|bug|fix|排查|修复/i },
  { role: 'review', pattern: /审查|review|看一下/i },
]

export interface Routed {
  decision: Decision
  reason: string
}

interface Hit {
  index: number
}

function firstHit(text: string, patterns: RegExp[]): Hit | null {
  let best: Hit | null = null
  for (const pattern of patterns) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
    const match = new RegExp(pattern.source, flags).exec(text)
    if (!match) continue
    if (!best || match.index < best.index) best = { index: match.index }
  }
  return best
}

/** 显式节奏词裁决（D2 数据：规则 1.00 > Flash 0.87）。无词时返回 1。 */
export function urgencyOf(text: string): Urgency {
  if (firstHit(text, URGENT)) return 2
  if (firstHit(text, LATER)) return 0
  return 1
}

function taskRole(text: string): string {
  for (const hint of ROLE_HINTS) {
    if (hint.pattern.test(text)) return hint.role
  }
  return 'worker'
}

function trimEdge(text: string): string {
  return text.replace(/^[，,、；;：:\s]+|[，,、；;：:\s]+$/gu, '').trim()
}

function summaries(text: string, target: Target): { chat: string; task: string } {
  const chatHit = firstHit(text, CHAT)
  const taskHit = firstHit(text, TASK)
  if (target !== 'mixed' || !chatHit || !taskHit) {
    const summary = clampText(collapseSpace(text), 80)
    return { chat: summary, task: summary }
  }
  const chatFirst = chatHit.index < taskHit.index
  let chatCut = chatFirst ? taskHit.index : chatHit.index
  let taskCut = chatFirst ? taskHit.index : 0
  if (chatFirst) {
    const head = text.slice(0, taskHit.index)
    const tail = URGENCY_TAIL.exec(head)
    if (tail && tail.index > 0) {
      chatCut = tail.index
      taskCut = tail.index
    }
  }
  const chat = trimEdge(chatFirst ? text.slice(0, chatCut) : text.slice(chatHit.index))
  const task = trimEdge(chatFirst ? text.slice(taskCut) : text.slice(0, chatHit.index))
  return {
    chat: clampText(collapseSpace(chat || text), 80),
    task: clampText(collapseSpace(task || text), 80),
  }
}

/** 关键词兜底。没有任务词就回主窗，避免把闲聊开成工单。 */
export function routeByRules(text: string): Routed {
  const chat = firstHit(text, CHAT)
  const task = firstHit(text, TASK)
  const urgency = urgencyOf(text)
  const pace = urgency === 2 ? '，紧急' : urgency === 0 ? '，可稍后' : ''
  let target: Target
  let reason: string
  if (chat && task) {
    target = 'mixed'
    reason = `关键词：闲聊与任务分开，主窗和工单各一张卡片${pace}`
  } else if (task) {
    target = 'worker'
    reason = `关键词：任务，交给角色 ${taskRole(text)}${pace}`
  } else if (chat) {
    target = 'main'
    reason = `关键词：闲聊，回主窗${pace}`
  } else {
    target = 'main'
    reason = `没有任务关键词，回主窗${pace}`
  }
  const parts = summaries(text, target)
  const cards: Card[] = []
  if (target === 'main' || target === 'mixed') {
    cards.push({ role: 'main', kind: 'chat', summary: parts.chat })
  }
  if (target === 'worker' || target === 'mixed') {
    cards.push({ role: taskRole(text), kind: 'task', summary: parts.task })
  }
  const decision: Decision = { target, urgency, cards }
  return { decision, reason }
}
