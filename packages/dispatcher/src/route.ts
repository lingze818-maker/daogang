import { parseDecision } from './decision.ts'
import { routeByRules, urgencyOf, type Routed } from './rules.ts'

export interface FlashRouter {
  /** null 表示不可用或结果不能用，调用方改走关键词。 */
  route(text: string): Promise<unknown>
}

/**
 * 混合裁决（灵泽 2026-11-02 拍板，D2 数据支撑）：
 * 语义路由（target/cards）信 Flash——trap 组 0.15→0.90；
 * urgency 信显式节奏词规则——规则 1.00 > Flash 0.87，"马上/不急"是精确信号，
 * 模型反而会过度理解（坏消息判急、吐槽判缓）。
 * 混合联合准确率 0.970（bench/compare.md，可复算）。
 */
export async function routeText(text: string, flash: FlashRouter): Promise<Routed & { via: 'flash' | 'rules' }> {
  try {
    const raw = await flash.route(text)
    const decision = parseDecision(raw)
    if (decision) {
      const ruleUrgency = urgencyOf(text)
      const overridden = ruleUrgency !== decision.urgency
      const paced = ruleUrgency !== 1 // 0/2 都来自显式节奏词；1 是规则默认
      const reason = overridden
        ? (paced ? 'Flash 路由（urgency 由节奏词裁决）' : 'Flash 路由（urgency 落规则默认）')
        : 'Flash 路由'
      return {
        decision: { ...decision, urgency: ruleUrgency },
        reason,
        via: 'flash',
      }
    }
  } catch {
    // 关键词兜底，不把上游错误原文带进审计。
  }
  return { ...routeByRules(text), via: 'rules' }
}
