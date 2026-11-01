# 文档

技术前提以结构笔记为准：TypeScript / pnpm / DeepSeek Harness（Cordis）；扩展走 Source 插件 + 外围分发器；每个 Ticket 一个 worker Session。当前发布是外围可用版 `0.1.0-peripheral`：CLI 能派单、打断和招领。执行口默认 Local；可选 `DAOGANG_DSH_ROOT` 只调用 `DshExecutor` 的 enqueue。Cordis 整链与 `configured()` 未验证。

| 文档 | 内容 |
| --- | --- |
| [开发预案-到岗-2026-11-01.md](./开发预案-到岗-2026-11-01.md) | 立项理由、分发与招领对照、拟人五维、阶段计划 |
| [TASKS.md](./TASKS.md) | 阶段 A–F。外围可用版已勾 B1、B3、B4、B5；B2 仍半开；E1 接口部分落地；B6 GIF 未做 |
| [notes/底座结构笔记-2026-11-01.md](./notes/底座结构笔记-2026-11-01.md) | 底座事实、入站到执行的路径、扩展点、不能依赖的内部 |
| [notes/MVP边界-外围分发器-2026-11-01.md](./notes/MVP边界-外围分发器-2026-11-01.md) | 可用版先做外围分发器 + inbox Source，以及刻意不做的事 |
| [notes/HostAdapter-对影-2026-11-01.md](./notes/HostAdapter-对影-2026-11-01.md) | 阶段 E1 接口骨架。默认本地 CLI；对影待问鎏虹 |

上游：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。该仓 Issues 已关闭，待验证项记在结构笔记 §7。
