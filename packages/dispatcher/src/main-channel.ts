/** 主窗回复桩。不等任务腿，也不调用底座 Channel。 */
export interface MainReply {
  channel: 'main-stub'
  session: 'main'
  text: string
  at: string
}

export function replyOnMain(input: { summary: string; at: string }): MainReply {
  return {
    channel: 'main-stub',
    session: 'main',
    text: `主窗先接住：${input.summary}`,
    at: input.at,
  }
}
