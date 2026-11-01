# 到岗（daogang）

一句话把 agent 叫到岗：打断能接住，走神能续上。

到岗是叠在 [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 上的拟人化实时协作层。人只面对一条对话；后台判断这句话该谁接、有多急，再把活派进对应的工单会话。招领看板不负责派活：它做审计和交接，并在派单失败时接住。

面向作品集，也给以后的宿主插件留接口。可用版之后的适配顺序是 **对影**，然后 zcode，然后 Codex。

## 为什么做

任务看板和 multi-agent 编排已经很多。缺的是工作节奏：永远秒回像假人，只靠异步轮询又像失联。到岗把「像同事」拆成可以复跑的五件事：即时到场、接得住打断、走神能回来、响应节奏不像机器、记得刚才说过的话。

底座于 2026-10-31 以 MIT 开源，周边还空。到岗不改它的内核，只走它公开的扩展面。

## 架构草图

```
一句话
  → 外围分发器
      Flash 路由 + 关键词兜底
      { target, urgency, cards }
  → inbox Source（合法 Trigger）
  → 底座 Ticket / Assignment
  → 每个 Ticket 一个 worker Session
      launch / delivery
  → 自建审计板（SQLite + JSONL）
      留痕，交接备注 ≤ 200 字
      目标离线或超时 → 落板招领
```

技术前提以 2026-11-01 的结构笔记为准：

- 底座是 **TypeScript / pnpm / DeepSeek Harness（Cordis）**，不是 Python 应用。
- 扩展路径是 **Source 插件 + 外围分发器**。上游有 Panel（运维侧栏）和 Source 先例，没有名为 bridge 的扩展层。
- Worker 是 **一张 Ticket 一个 Session**（`worker-<ticketId>`），不是三个一直活着的角色进程。角色可以有多个，用路由表映射到 Ticket。
- 上游仓库关闭了 Issues。待验证问题记在本仓笔记里。

分发器先放在外围：自己做路由、打断和 mixed 拆分，再经 Source 注入。站稳之后再考虑收成 Cordis 插件。

## 状态

阶段 B 已开工，CLI 能演示「派得出、有人接」。

- 2026-11-01：阶段 A 完成。底座结构笔记和 MVP 边界已写入 `docs/notes/`。
- 阶段 B 本批：`packages/dispatcher` 读一句话，输出 `{target, urgency, cards}`；`packages/board` 把审计行追加到 JSONL；`packages/inbox-source` 在本地接单，任务腿回执 `worker-<ticketId>`。
- 仍是桩：DeepSeek Harness / Cordis 未安装，没有 Assignment，也没有 `DshExecutor.start`。打断与抢占未做。Flash 只在设置了 `DEEPSEEK_API_KEY` 时请求，失败或没密钥就用关键词。

## 快速试跑

需要 Node.js `>=22.19` 和 pnpm 10。没有 API key 也能跑。

```bash
pnpm install
pnpm test
pnpm dispatch -- "帮我补上安装说明"
pnpm board
```

`pnpm dispatch` 往标准输出打一份 JSON：`target`、`urgency`、`cards`，以及本地 inbox 的接单回执。审计行在 `.daogang/board.jsonl`（可用 `DAOGANG_HOME` 改目录）。`.daogang/` 不进仓库。

从标准输入读一行：

```bash
printf '%s\n' "你好" | pnpm dispatch
```

常驻进程，一行一句，直到标准输入结束：

```bash
pnpm listen
```

设置密钥后，同一条命令会先请求 `deepseek-flash`（思考模式关掉）。请求失败或没密钥时仍回落到关键词。变量见 `.env.example`。不要把真实密钥提交进仓库。

接单回执里的 `worker-<ticketId>` 是本地会话名，用来把「有人接」跑通。它还不是底座里那个 Ticket Session。

## 文档

- [文档索引](docs/README.md)
- [开发预案](docs/开发预案-到岗-2026-11-01.md)
- [任务清单](docs/TASKS.md)
- [底座结构笔记](docs/notes/底座结构笔记-2026-11-01.md)
- [MVP 边界：外围分发器](docs/notes/MVP边界-外围分发器-2026-11-01.md)

## 许可

[MIT](LICENSE) © 2026 lingze818-maker

本仓库是独立实验，不是 DeepSeek 官方产品。上游原型：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）。
