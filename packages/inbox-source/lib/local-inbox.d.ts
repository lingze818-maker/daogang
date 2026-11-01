import type { InboxTrigger } from './trigger.js';
export interface InboxReceipt {
    status: 'accepted' | 'duplicate';
    triggerId: string;
    ticketId: string | null;
    session: string;
    lane: 'chat' | 'task';
    at: string;
}
/**
 * `SourceContext.receive` 的本地替身。
 * 任务腿分配 `worker-<ticketId>`；闲聊腿记到 `main`。
 * 同一 Trigger id 再投一次返回 duplicate，不新开票。
 * 这里没有调用底座 Assignment 或 DshExecutor.start。派工在分发器的执行口。
 */
export declare class LocalInbox {
    readonly file: string;
    private readonly ticketId;
    constructor(file: string, ticketId?: () => string);
    receive(trigger: InboxTrigger): InboxReceipt;
    private read;
    private write;
}
