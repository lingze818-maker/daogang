export declare const TARGETS: readonly ["main", "worker", "mixed"];
export type Target = (typeof TARGETS)[number];
export type Urgency = 0 | 1 | 2;
export type CardKind = 'chat' | 'task';
export interface Card {
    role: string;
    kind: CardKind;
    summary: string;
}
/** 分发器对一句话的判定。角色是产品层标签，不是长驻进程。 */
export interface Decision {
    target: Target;
    urgency: Urgency;
    cards: Card[];
}
