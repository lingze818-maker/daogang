import { z } from 'zod';
import { type InboxScopeResult, type InboxTrigger } from './trigger.js';
/**
 * Cordis Source 插件入口。对照上游 docs/008-cookbook.md 第 4、9、10 步。
 * 不 import `@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-*`。
 * 宿主有 `effect` 时按食谱登记 kind，并在 `context()` 给出的 SourceContext 上走 receive。
 * 没有 `effect` 时只 `register`，本地 `LocalInbox` 不受影响。
 * schema 是 Zod（`parse` / `safeParse`）。`configured()` 由宿主给出；
 * 没配 GitHub 仓库时底座 Setup 会让它返回 false，本插件此时只报 `setupPending`。
 */
export interface InboxSourceConfig {
    conversation: string;
}
/**
 * 对照 cookbook 的 Zod schema：`parse` 与 `safeParse` 都在。
 * 默认对话是 `cli`，只听这一条，不是「全部对话」。
 * `parseInboxConfig` 把缺省和空字符串收成 `cli`。schema 对空字符串和多余的键 `safeParse` 失败。
 * 底座 `SourceRegistry` 在 `safeParse` 失败时改用 `parse({})` 并关掉这一实例。
 */
export declare const inboxConfigSchema: z.ZodObject<{
    conversation: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare function parseInboxConfig(input: unknown): InboxSourceConfig;
/** 策略片段。默认 `allowed` 为空：没人能发起工作，除非配置里写上发送者。 */
export declare const inboxPolicySchema: z.ZodObject<{
    allowed: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export interface InboxAdmissionRow {
    id: string;
    label: string;
    note: {
        zh: string;
        en: string;
    };
    cells: {
        listedUnaddressed: boolean;
        unlistedAddressed: boolean;
        unlistedUnaddressed: boolean;
    };
}
export declare const inboxKind: {
    kind: "inbox";
    title: {
        zh: string;
        en: string;
    };
    description: {
        zh: string;
        en: string;
    };
    health: readonly ["inbox"];
    schema: z.ZodObject<{
        conversation: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>;
    fields: {
        key: string;
        type: "text";
        pattern: string;
        label: {
            zh: string;
            en: string;
        };
    }[];
    scope(input: {
        meta?: {
            conversation?: string;
        };
    }, config: unknown): InboxScopeResult;
    policy: {
        schema: z.ZodObject<{
            allowed: z.ZodDefault<z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>>;
        }, z.core.$strict>;
        fields: {
            key: string;
            type: "rows";
            label: {
                zh: string;
                en: string;
            };
            columns: ({
                key: string;
                type: "text";
                label: {
                    zh: string;
                    en: string;
                };
                optional?: undefined;
            } | {
                key: string;
                type: "text";
                label: {
                    zh: string;
                    en: string;
                };
                optional: boolean;
            })[];
        }[];
        explicit: {
            zh: string;
            en: string;
        };
        rows(config: unknown): InboxAdmissionRow[];
    };
};
export interface InboxHealth {
    state: 'ready' | 'paused' | 'error';
    detail: string;
    code?: 'setupPending' | 'sourceOff';
    at?: string;
}
export interface InboxLoopHost {
    ready?: Promise<unknown>;
    configured?(): boolean;
    config?(kind: string): unknown;
    receive?(trigger: InboxTrigger): unknown;
    report?(entry: string, health: InboxHealth): void;
}
export interface InboxHostSketch {
    sources: {
        /** 底座 `SourceRegistry.register` 返回卸载函数。草图宿主可以不返回。 */
        register(kind: typeof inboxKind): void | (() => void);
        unregister?(kind: string): void;
    };
    /** 上游 SourceHost.context。有则用它拿 SourceContext，不 import host.ts。 */
    context?(kind: typeof inboxKind): InboxLoopHost;
    report?(entry: string, health: InboxHealth): void;
}
export interface InboxPluginContext {
    orchestrator: InboxHostSketch;
    effect?(run: () => void | (() => void | Promise<void>), label?: string): void;
    /** 外围或测试推入 Trigger。Cordis 不提供这个字段时，循环没有可 receive 的事件。 */
    inboxFeed?: InboxFeed;
}
/** 插件内部队列。稳定 id 由调用方放在 Trigger 上，这里不另造游标。 */
export declare class InboxFeed {
    private readonly queued;
    private readonly waiters;
    push(trigger: InboxTrigger): void;
    take(signal: AbortSignal): Promise<InboxTrigger | undefined>;
}
/**
 * 食谱里的接收循环形状：等 ready，setup 未完成就停，关着就不读，
 * 然后 scope（只看 meta 与配置）之后仍把 Trigger 交给 receive，不在循环里悄悄丢掉。
 */
export declare function watchInbox(host: InboxLoopHost, feed: InboxFeed, signal: AbortSignal): Promise<void>;
export declare function apply(ctx: InboxPluginContext): void;
export declare const name = "daogang-inbox";
export declare const inject: readonly ["orchestrator"];
export declare const pluginName = "daogang-inbox";
export declare const pluginInject: readonly ["orchestrator"];
