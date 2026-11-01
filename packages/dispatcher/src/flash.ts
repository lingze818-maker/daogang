import type { FlashRouter } from './route.ts'

const DEFAULT_BASE = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-flash'

const SYSTEM = [
  '你是「到岗」分发器。只输出一个 JSON 对象，不要 markdown，不要解释。',
  '字段：',
  '- target: "main" | "worker" | "mixed"',
  '- urgency: 0 | 1 | 2',
  '- cards: 数组，每项 { "role": string, "kind": "chat" | "task", "summary": string }',
  '语义：',
  '- 纯闲聊 → target "main"，一张 kind "chat"、role "main" 的卡片',
  '- 明确要人做事 → target "worker"，一张 kind "task" 的卡片，role 用小写英文（docs、review、fix、worker）',
  '- 同一句里既有闲聊又有任务 → target "mixed"，先 chat 卡再 task 卡',
  '- urgency 2 要立刻处理，0 可以稍后，1 普通',
  'summary 用简短中文，不超过 80 字。',
].join('\n')

function stripFence(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? content).trim()
}

/**
 * 没有密钥时 `route` 返回 null，分发器改走关键词。
 * 请求失败、非 JSON、或 HTTP 非 2xx 同样返回 null，不把密钥写进错误。
 * thinking 关掉，避免路由被推理文本拖慢。
 */
export function createFlashRouter(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): FlashRouter {
  const key = env.DEEPSEEK_API_KEY?.trim() ?? ''
  if (!key) {
    return { async route() { return null } }
  }
  const base = (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/$/, '')
  const model = env.DAOGANG_FLASH_MODEL?.trim() || DEFAULT_MODEL
  return {
    async route(text: string): Promise<unknown> {
      try {
        const response = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: text },
            ],
            temperature: 0,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) return null
        const body = (await response.json()) as {
          choices?: { message?: { content?: string | null } }[]
        }
        const content = body.choices?.[0]?.message?.content
        if (!content) return null
        return JSON.parse(stripFence(content)) as unknown
      } catch {
        return null
      }
    },
  }
}
