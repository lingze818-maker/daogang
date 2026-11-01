/** 公开 `triggerMessage` 只读 Trigger.text，不读 meta。卡片要进 worker 首条消息，就得写在 text 里。 */
export const CARD_MARK = '[daogang-cards]';
function oneLine(summary) {
    return summary.replace(/\s+/g, ' ').trim();
}
/** 本腿卡片的固定文本。`ticketExecution` 的 note 和 `inputMessage` 的 text 输入用同一段。 */
export function cardBlock(cards) {
    if (cards.length === 0)
        return '';
    return [CARD_MARK, ...cards.map((card) => `- ${card.role}/${card.kind}: ${oneLine(card.summary)}`)].join('\n');
}
/** 用户原话在前，卡片块在后。空卡片不改原文。 */
export function textWithCards(text, cards) {
    const block = cardBlock(cards);
    if (!block)
        return text;
    const body = text.replace(/\s+$/u, '');
    if (!body)
        return block;
    return `${body}\n\n${block}`;
}
export function inboxTrigger(input) {
    const conversation = input.conversation ?? 'cli';
    const lane = input.lane;
    const cards = input.decision.cards.filter((item) => item.kind === lane);
    const card = cards[0];
    if (!card) {
        throw new Error(`分发结果缺少 ${lane} 卡片`);
    }
    const thread = `${conversation}:${input.messageId}`;
    return {
        id: `inbox:${input.messageId}:${lane}`,
        source: 'inbox',
        threads: [{ source: 'inbox', id: thread }],
        actor: { source: 'inbox', id: input.actorId ?? 'cli-user' },
        human: true,
        addressed: 'direct',
        at: input.at,
        text: textWithCards(input.text, cards),
        channel: {
            source: 'inbox',
            thread: `inbox:${thread}`,
            address: { conversation, message: input.messageId },
        },
        meta: {
            conversation,
            messageId: input.messageId,
            target: input.decision.target,
            urgency: input.decision.urgency,
            lane,
            card,
            cards,
            policy: 'explicit',
        },
    };
}
/** 只看 meta 与配置。未列入的对话记为 filtered，不在翻译阶段悄悄丢掉。 */
export function inboxScope(meta, config) {
    if (meta.conversation !== config.conversation) {
        return { listened: false, observed: false, reason: 'conversation_not_listed' };
    }
    return { listened: true, observed: false, row: config.conversation };
}
