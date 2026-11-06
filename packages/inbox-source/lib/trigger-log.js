import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
/**
 * 跨进程桥（issue #24，文件方案）：dispatch CLI 与 DSH 服务是两个进程，
 * trigger 经 DAOGANG_HOME/triggers.jsonl 传递——append-only，一行一个
 * InboxTrigger 的 JSON。读侧按 id 去重：LocalInbox 与 orchestrator 的
 * 接单都以 trigger id 幂等，桥本身只需保证不重复投递。
 */
/** 单文件上限（默认 5MB）：超限轮转成 .1（覆盖旧 .1，只留一档——桥是热数据，旧 trigger 无回放价值）。 */
const ROTATE_BYTES = 5 * 1024 * 1024;
/** dispatcher 侧：接单成功（accepted）后追加；超限先轮转。写侧不校验内容。 */
export function appendTrigger(file, trigger, rotateBytes = ROTATE_BYTES) {
    try {
        if (existsSync(file) && statSync(file).size >= rotateBytes) {
            try {
                renameSync(`${file}.1`, `${file}.2`);
            }
            catch { /* 首次轮转没有 .2 */ }
            renameSync(file, `${file}.1`);
        }
    }
    catch { /* stat 失败按未超限处理，不影响投递主路 */ }
    appendFileSync(file, `${JSON.stringify(trigger)}\n`, 'utf8');
}
/**
 * DSH 侧：轮询 tail。文件不存在视为空；新增行按 id 去重后回调；
 * 解析失败的行跳过（写侧崩溃留下的半行不阻塞后续）。
 * 返回停止函数；signal 中止后不再回调。
 */
export function watchTriggerLog(file, onTrigger, signal, options = {}) {
    const intervalMs = options.intervalMs ?? 250;
    const seen = options.seen ?? new Set();
    let stopped = false;
    const stop = () => { stopped = true; };
    const onAbort = () => { stopped = true; };
    signal.addEventListener('abort', onAbort, { once: true });
    const tick = () => {
        if (stopped) {
            signal.removeEventListener('abort', onAbort);
            return;
        }
        try {
            if (existsSync(file)) {
                const text = readFileSync(file, 'utf8');
                for (const line of text.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    let trigger;
                    try {
                        trigger = JSON.parse(trimmed);
                    }
                    catch {
                        continue;
                    }
                    if (!trigger || trigger.source !== 'inbox' || !trigger.id || seen.has(trigger.id))
                        continue;
                    seen.add(trigger.id);
                    if (!stopped)
                        onTrigger(trigger);
                }
            }
        }
        catch {
            // 读侧竞态（写侧正在写）按本轮空过处理，下轮再读。
            // ⚠️ 这里曾经静默吞过 ReferenceError（import 丢了 readFileSync）——排查此类问题先开临时探针看外层 catch。
        }
        if (!stopped)
            setTimeout(tick, intervalMs);
    };
    setTimeout(tick, 0);
    return stop;
}
