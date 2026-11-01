import { parseDecision } from './decision.ts'
import { routeByRules, type Routed } from './rules.ts'

export interface FlashRouter {
  /** null 表示不可用或结果不能用，调用方改走关键词。 */
  route(text: string): Promise<unknown>
}

export async function routeText(text: string, flash: FlashRouter): Promise<Routed & { via: 'flash' | 'rules' }> {
  try {
    const raw = await flash.route(text)
    const decision = parseDecision(raw)
    if (decision) {
      return { decision, reason: 'Flash 路由', via: 'flash' }
    }
  } catch {
    // 关键词兜底，不把上游错误原文带进审计。
  }
  return { ...routeByRules(text), via: 'rules' }
}
