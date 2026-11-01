# inbox Source（草图）

本包是到岗的收件 Source **形状**，不是已经装进 DeepSeek Harness 的 Cordis 插件。

CLI 用 `LocalInbox.receive` 模拟「有人接」：

- 任务腿分配一个 `worker-<ticketId>` 会话名
- 闲聊腿记到 `main`
- 同一个 Trigger id 再投一次得到 `duplicate`，不新开票

这不等于底座的 Assignment，也没有调用 `DshExecutor.start` / Effects `launch`。产品层的角色写在卡片上，实现层仍是一票一个会话名。

## 对照上游食谱

不要把 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 整仓复制进来。Source 的写法以这篇为准：

[docs/008-cookbook.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)

食谱要求四件事：把事件译成 Trigger、定接收与授权、提供回复与上下文、维持接收循环。本包对应关系：

| 食谱 | 本包 | 状态 |
| --- | --- | --- |
| 译成 Trigger（稳定 id、Thread、actor、`addressed`） | `inboxTrigger` | 字段按 Trigger 形状已有。CLI 每条输入 `addressed: direct` |
| `scope`，未列入的对话留给面板解释 | `inboxScope` | 只看 `meta.conversation`。未注册进 Engine |
| Policy 的 explicit | Trigger 上 `policy: 'explicit'` | 形状在。名单与准入表未进底座 Policy |
| Channel：`send` 幂等，只有永久失败才 `gone` | — | 未做 |
| `threadContext` | — | 未做 |
| 插件 `apply` + 循环里 `ctx.receive` | `apply` + `LocalInbox` | `apply` 只向草图宿主 `register`。接收循环是本地 JSON 文件，不是 Cordis effect |
| `package.json` exports、`cordis.patch.yml` insert | `cordis.patch.example.yml` | 注释示例。未安装 `@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-*` |

不能依赖的内部类见仓库 [底座结构笔记 §6](../../docs/notes/底座结构笔记-2026-11-01.md)。本包不 import `Engine`、`Store`、`DshExecutor`。

## 还没验证的上游问题

自定义 Source 在没有 GitHub / 飞书账号时，Setup 会不会挡住 `configured()`，记在结构笔记 §7 第 7 条。本桩不调用 `configured()`，所以没有回答这个问题。
