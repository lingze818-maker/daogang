import type { Decision } from './decision.js';
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
        card: Decision['cards'][number];
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
