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

## 外围可用版 `0.1.0-peripheral`

这一版是外围 CLI，不是挂进 DeepSeek Harness 的插件。没有 API key 也能跑。

今天能用：

- `pnpm dispatch` / `pnpm listen`：一句话进，打出 `{target, urgency, cards}`。没设 `DEEPSEEK_API_KEY` 时用关键词；设了才请求 `deepseek-flash`，失败仍回落关键词。
- 闲聊走 `mainReply`（通道 `main-stub`），和任务腿分开。任务排队或失败时，主窗回复已经留下。
- 更高优先级打断正在忙的工单：那一行改成 `queued`，交接备注不超过 200 字。同级或更低只排队。
- 接单失败追加 `"status":"claim"` 的招领行。`DAOGANG_FAIL_LANE=task` 用来演示离线或超时。
- `bash scripts/demo.sh` 把上面串成一次终端演示。记录在 [docs/demo/peripheral.cast](docs/demo/peripheral.cast)。GIF 还没有。

还是桩，**B2 的真 DSH 不在这一版**：

- 默认执行口是 `LocalExecutor`（`packages/dispatcher/src/executor.ts`）。它把派工记在 `.daogang/executor.json`，会话名是 `worker-<ticketId>`。
- `DshExecutorAdapter` 只标出上游调用点：`DshExecutor.start` → Effects `enqueue('launch', assignmentId, { ticketId, assignmentId })`，`deliver` → `enqueue('delivery', ticketId, { ticketId })`。不安装 `@deepseek-ai/dsh-*` 或 Cordis。`DAOGANG_EXECUTOR=dsh` 不会开会话，这次派工落成招领。
- 没有 Assignment，也没有底座里的 Ticket Session。主窗不是 Channel。

## 状态

- 2026-11-01：阶段 A 完成。底座结构笔记和 MVP 边界已写入 `docs/notes/`。
- 版本号写在根 `package.json` 的 `0.1.0-peripheral`。这是外围可用版，不是底座插件发布。

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

## 接着试

快速试跑不用改。下面这组用一块干净目录，把主窗、打断和招领连起来。仍然不需要 API key。

```bash
bash scripts/demo.sh
```

脚本里发生四件事：先派一件普通任务；再派一句更急的 mixed（输出里有 `mainReply`，同时把上一张工单改成排队并写交接备注）；再派一件不急的，它只排队、不打断；最后用 `DAOGANG_FAIL_LANE=task` 让任务腿失败，看板上多一行 `"status":"claim"`。`pnpm board` 打在最后。

同一段输出也录在 `docs/demo/peripheral.cast`。装了 asciinema 时可以 `asciinema play docs/demo/peripheral.cast`。需要重录时跑 `node scripts/record-cast.mjs`。没有 GIF。

## 文档

- [文档索引](docs/README.md)
- [开发预案](docs/开发预案-到岗-2026-11-01.md)
- [任务清单](docs/TASKS.md)
- [底座结构笔记](docs/notes/底座结构笔记-2026-11-01.md)
- [MVP 边界：外围分发器](docs/notes/MVP边界-外围分发器-2026-11-01.md)

## 许可

[MIT](LICENSE) © 2026 lingze818-maker

本仓库是独立实验，不是 DeepSeek 官方产品。上游原型：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）。
