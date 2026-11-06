# 文档

技术前提以结构笔记为准：TypeScript / pnpm / DeepSeek Harness（Cordis）；扩展走 Source 插件 + 外围分发器；每个 Ticket 一个 worker Session。当前发布是外围可用版 `0.1.0-peripheral`：CLI 能派单、打断和招领。执行口默认 Local；可选 `DAOGANG_DSH_ROOT` 的适配器仍把 enqueue 记在站位 effects 上。`scripts/check-effects.mjs` 能在已安装的上游克隆里看到 `effect` 表的行，以及卡片留在公开 prompt 文本里。`scripts/check-runtime.mjs` 在能解析 `await using` 的 Node（24+）上构造空配置的 Runtime（停在 `setupPending`），用夹具让 `configured()` 为 true 后看到 `effects.start()` 和桩住的主会话 `ensure`，并用 stub `sessions.prompt` 看到卡片。同一脚本在 `effects.start` 之后记录 `SessionController` 的公开硬挡，并用 `SessionStore.create` 得到同一 `masterId` 的 `Session`。`sessionController` 管的活 Agent、真实 `gh` 身份和真实模型请求仍未验证。inbox Source 的挂载见 `packages/inbox-source/README.md`。

| 文档 | 内容 |
| --- | --- |
| [开发预案-到岗-2026-11-01.md](./开发预案-到岗-2026-11-01.md) | 立项理由、分发与招领对照、拟人五维、阶段计划 |
| [TASKS.md](./TASKS.md) | 阶段 A–F。外围可用版已勾 B1、B3、B4、B5；B2 仍半开；E1 接口部分落地；B6 GIF 未做 |
| [CHANGELOG-draft.md](./CHANGELOG-draft.md) | 11-02 草稿与 11-03 增补：评测数字、混合裁决、跨进程桥、外部审库与已知边界 |
| [notes/底座结构笔记-2026-11-01.md](./notes/底座结构笔记-2026-11-01.md) | 底座事实、入站到执行的路径、扩展点、不能依赖的内部。文末 §9 是 2026-11-02 交叉核对 |
| [notes/MVP边界-外围分发器-2026-11-01.md](./notes/MVP边界-外围分发器-2026-11-01.md) | 可用版先做外围分发器 + inbox Source，以及刻意不做的事 |
| [notes/HostAdapter-对影-2026-11-01.md](./notes/HostAdapter-对影-2026-11-01.md) | 对影六条口径（鎏虹 2026-11-01，main `5662082`）。#59 已合入；进窗与用户话 loopback 真调通过 |
| [notes/闭环时间线-2026-11-02.md](./notes/闭环时间线-2026-11-02.md) | 从 D1 评测到首个 DSH worker PR（#26）的时间线、闭环路径与未完成边界 |

上游：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。该仓 Issues 已关闭，待验证项记在结构笔记 §7。
