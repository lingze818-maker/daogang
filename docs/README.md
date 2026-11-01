# 文档

技术前提以结构笔记为准：TypeScript / pnpm / DeepSeek Harness（Cordis）；扩展走 Source 插件 + 外围分发器；每个 Ticket 一个 worker Session。阶段 B 的可运行脚手架在仓库 `packages/`（分发器 CLI、JSONL 审计板、inbox 接单桩）。Cordis 与底座 Assignment 还没接上。

| 文档 | 内容 |
| --- | --- |
| [开发预案-到岗-2026-11-01.md](./开发预案-到岗-2026-11-01.md) | 立项理由、分发与招领对照、拟人五维、阶段计划 |
| [TASKS.md](./TASKS.md) | 阶段 A–F 与杂项清单；A 已完成，B1 的外围 CLI 已可跑 |
| [notes/底座结构笔记-2026-11-01.md](./notes/底座结构笔记-2026-11-01.md) | 底座事实、入站到执行的路径、扩展点、不能依赖的内部 |
| [notes/MVP边界-外围分发器-2026-11-01.md](./notes/MVP边界-外围分发器-2026-11-01.md) | 可用版先做外围分发器 + inbox Source，以及刻意不做的事 |

上游：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)。该仓 Issues 已关闭，待验证项记在结构笔记 §7。
