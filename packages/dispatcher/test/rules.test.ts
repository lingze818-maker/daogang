import { describe, expect, it } from 'vitest'
import { parseDecision } from '../src/decision.ts'
import { routeByRules } from '../src/rules.ts'
import { SUMMARY_MAX } from '../src/text.ts'

describe('keyword router', () => {
  it('sends a task to a worker card', () => {
    const routed = routeByRules('帮我补上安装说明')
    expect(routed.decision).toEqual({
      target: 'worker',
      urgency: 1,
      cards: [{ role: 'docs', kind: 'task', summary: '帮我补上安装说明' }],
    })
  })

  it('keeps a greeting on main', () => {
    expect(routeByRules('你好').decision.target).toBe('main')
    expect(routeByRules('你好').decision.cards).toEqual([
      { role: 'main', kind: 'chat', summary: '你好' },
    ])
    expect(routeByRules('嗯').decision.target).toBe('main')
    expect(routeByRules('嗯').reason).toContain('没有任务关键词')
  })

  it('splits mixed input into chat and task cards', () => {
    const routed = routeByRules('谢谢，帮我修一下 bug')
    expect(routed.decision.target).toBe('mixed')
    expect(routed.decision.cards).toEqual([
      { role: 'main', kind: 'chat', summary: '谢谢' },
      { role: 'fix', kind: 'task', summary: '帮我修一下 bug' },
    ])
  })

  it('keeps an urgency word with the task when it sits between chat and work', () => {
    const routed = routeByRules('谢谢，马上帮我修一下 bug')
    expect(routed.decision.urgency).toBe(2)
    expect(routed.decision.cards).toEqual([
      { role: 'main', kind: 'chat', summary: '谢谢' },
      { role: 'fix', kind: 'task', summary: '马上帮我修一下 bug' },
    ])
  })

  it('marks urgent and later lines', () => {
    expect(routeByRules('马上帮我修一下').decision.urgency).toBe(2)
    expect(routeByRules('不急，帮我写文档').decision).toMatchObject({
      target: 'worker',
      urgency: 0,
      cards: [{ role: 'docs', kind: 'task', summary: '不急，帮我写文档' }],
    })
  })

  it('clamps card summaries', () => {
    const summary = routeByRules(`帮我${'字'.repeat(200)}`).decision.cards[0]?.summary ?? ''
    expect(Array.from(summary).length).toBe(SUMMARY_MAX)
  })
})

describe('parseDecision', () => {
  it('accepts a flash payload and drops an invalid one', () => {
    expect(parseDecision({
      target: 'worker',
      urgency: '2',
      cards: [{ role: 'fix', kind: 'task', summary: '修一下' }],
    })).toEqual({
      target: 'worker',
      urgency: 2,
      cards: [{ role: 'fix', kind: 'task', summary: '修一下' }],
    })
    expect(parseDecision({ target: 'mixed', urgency: 1, cards: [{ role: 'main', kind: 'chat', summary: '只闲聊' }] })).toBeNull()
    expect(parseDecision({ target: 'nope', urgency: 1, cards: [] })).toBeNull()
  })
})
