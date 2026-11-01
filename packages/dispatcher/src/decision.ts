import { TARGETS, type Card, type Decision, type Target, type Urgency } from '@daogang/inbox-source'
import { clampText, collapseSpace } from './text.ts'

const ROLE = /^[a-z][a-z0-9-]{0,31}$/

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asTarget(value: unknown): Target | null {
  return typeof value === 'string' && (TARGETS as readonly string[]).includes(value) ? (value as Target) : null
}

function asUrgency(value: unknown): Urgency | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (number === 0 || number === 1 || number === 2) return number
  return null
}

function asCard(value: unknown): Card | null {
  const record = asRecord(value)
  if (!record) return null
  if (record.kind !== 'chat' && record.kind !== 'task') return null
  if (typeof record.summary !== 'string' || !collapseSpace(record.summary)) return null
  const fallback = record.kind === 'chat' ? 'main' : 'worker'
  const role = typeof record.role === 'string' && ROLE.test(record.role) ? record.role : fallback
  return {
    role,
    kind: record.kind,
    summary: clampText(collapseSpace(record.summary), 80),
  }
}

/** Flash 输出不合法时返回 null，调用方改走关键词。 */
export function parseDecision(value: unknown): Decision | null {
  const record = asRecord(value)
  if (!record) return null
  const target = asTarget(record.target)
  const urgency = asUrgency(record.urgency)
  if (!target || urgency === null || !Array.isArray(record.cards)) return null
  const cards: Card[] = []
  for (const item of record.cards) {
    const card = asCard(item)
    if (!card) return null
    cards.push(card)
  }
  if (cards.length === 0) return null
  const kinds = new Set(cards.map((card) => card.kind))
  if (target === 'main' && (kinds.size !== 1 || !kinds.has('chat'))) return null
  if (target === 'worker' && (kinds.size !== 1 || !kinds.has('task'))) return null
  if (target === 'mixed' && (!kinds.has('chat') || !kinds.has('task'))) return null
  return { target, urgency, cards }
}
