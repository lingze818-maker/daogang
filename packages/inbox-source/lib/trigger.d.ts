import type { Card, Decision } from './decision.js';
/** 公开 `triggerMessage` 只读 Trigger.text，不读 meta。卡片要进 worker 首条消息，就得写在 text 里。 */
export declare const CARD_MARK = "[daogang-cards]";
/** 本腿卡片的固定文本。`ticketExecution` 的 note 和 `inputMessage` 的 text 输入用同一段。 */
export declare function cardBlock(cards: readonly Card[]): string;
/** 用户原话在前，卡片块在后。空卡片不改原文。 */
export declare function textWithCards(text: string, cards: readonly Card[]): string;
export interface InboxActor {
    source: 'inbox';
    id: string;
}
export interface InboxTrigger {
    id: string;
    source: 'inbox';
    threads: [{
        source: 'inbox';
        id: string;
    }];
    actor: InboxActor;
    human: true;
    /** CLI 输入视为对智能体的直接发言，对齐底座 explicit 直通，不走 inferred 研判。 */
    addressed: 'direct';
    at: string;
    text: string;
    channel: {
        source: 'inbox';
        thread: string;
        address: {
            conversation: string;
            message: string;
        };
    };
    meta: {
        conversation: string;
        messageId: string;
        target: Decision['target'];
        urgency: Decision['urgency'];
        lane: 'chat' | 'task';
        /** 本腿的第一张卡片。旧字段，和 `cards[0]` 相同。 */
        card: Decision['cards'][number];
        /** 本腿全部卡片。底座核心不解释 meta；worker prompt 读的是 text 里的同一段。 */
        cards: Decision['cards'];
        policy: 'explicit';
    };
}
export interface InboxScopeResult {
    listened: boolean;
    observed: boolean;
    row?: string;
    reason?: string;
}
export declare function inboxTrigger(input: {
    messageId: string;
    at: string;
    text: string;
    decision: Decision;
    lane: 'chat' | 'task';
    actorId?: string;
    conversation?: string;
}): InboxTrigger;
/** 只看 meta 与配置。未列入的对话记为 filtered，不在翻译阶段悄悄丢掉。 */
export declare function inboxScope(meta: {
    conversation?: string;
}, config: {
    conversation: string;
}): InboxScopeResult;
