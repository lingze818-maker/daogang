# inbox Source

本包是到岗的收件 Source。CLI 仍用 `LocalInbox.receive`，不经过 Cordis：

- 任务腿分配一个 `worker-<ticketId>` 会话名
- 闲聊腿记到 `main`
- 同一个 Trigger id 再投一次得到 `duplicate`，不新开票

这不等于底座的 Assignment，也没有调用 `DshExecutor.start`。产品层的角色写在卡片上，实现层仍是一票一个会话名。派工在分发器的 `ExecutorPort`：默认 `LocalExecutor`。设置 `DAOGANG_DSH_ROOT` 时，适配器才按路径调用克隆里的 `start` / `deliver`。

## 对照上游食谱

不要把 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 整仓复制进来。Source 的写法以这篇为准：

[docs/008-cookbook.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)

| 食谱 | 本包 | 状态 |
| --- | --- | --- |
| 译成 Trigger（稳定 id、Thread、actor、`addressed`） | `inboxTrigger` | CLI 每条输入 `addressed: direct` |
| `scope`，未列入的对话仍交给 receive | `inboxKind.scope` → `inboxScope` | 只看 `meta.conversation`。真实 Engine 未挂 |
| Policy 的 explicit 与 admission `rows` | `inboxKind.policy` | 形状在。不是 Zod，名单未进底座 Policy |
| Channel：`send` 幂等，只有永久失败才 `gone` | 分发器里的 `main-stub` | 主窗是本地桩，不是底座 Channel.send |
| `threadContext` | — | 未做 |
| 插件 `name` / `inject` / `apply`，`effect` 里 register，循环里 `receive` | `apply` + `watchInbox` | 宿主没有 `effect` 时只 `register`。有 `context()` 时用它，不 import `host.ts` |
| `package.json` exports、`cordis.patch.yml` insert | `exports["."]`、`cordis.patch.yml` | 默认 `disabled: true`。入口是 `.ts`，不是 `lib/*.js` |

`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-*` 都不是本包的 dependency 或 peerDependency。pnpm 会把可选 peer 写进锁文件并装上，所以这里不声明，改由文档说明：执行口用 `DAOGANG_DSH_ROOT` 指到本机克隆；要让 Cordis 解析到本包，在那个克隆里用 `file:` 或 `pnpm link`。

不能依赖的内部类见仓库 [底座结构笔记 §6](../../docs/notes/底座结构笔记-2026-11-01.md)。本包不 import `Engine`、`Store`、`DshExecutor`。

## 还没验证

自定义 Source 在没有 GitHub / 飞书账号时，Setup 会不会挡住 `configured()`，记在结构笔记 §7 第 7 条。插件在宿主提供 `configured()` 且返回 false 时会上报 `setupPending` 并不 `receive`。本仓没有在真实 Cordis 进程里调用过它，所以这仍是 **未验证**。`SourceRegistry` 是否接受非 Zod 的 `schema`，同样未验证。
