import type { InboxTrigger } from './trigger.js';
/**
 * 跨进程桥（issue #24，文件方案）：dispatch CLI 与 DSH 服务是两个进程，
 * trigger 经 DAOGANG_HOME/triggers.jsonl 传递——append-only，一行一个
 * InboxTrigger 的 JSON。读侧按 id 去重：LocalInbox 与 orchestrator 的
 * 接单都以 trigger id 幂等，桥本身只需保证不重复投递。
 */
/** dispatcher 侧：接单成功（accepted）后追加。坏行由读侧跳过，写侧不校验。 */
export declare function appendTrigger(file: string, trigger: InboxTrigger): void;
export interface WatchOptions {
    /** 轮询间隔毫秒，默认 250（首响实测：1000ms 粒度占全链路 4.1s 中的 1s）。 */
    intervalMs?: number;
    /** 已见 id 的初值（重启续读时传入），默认空。 */
    seen?: Set<string>;
}
/**
 * DSH 侧：轮询 tail。文件不存在视为空；新增行按 id 去重后回调；
 * 解析失败的行跳过（写侧崩溃留下的半行不阻塞后续）。
 * 返回停止函数；signal 中止后不再回调。
 */
export declare function watchTriggerLog(file: string, onTrigger: (trigger: InboxTrigger) => void, signal: AbortSignal, options?: WatchOptions): () => void;
