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

**B2 仍半开。** 默认没有真 DSH 会话。可选根目录只把 `start` / `deliver` 的 enqueue 接到站位 effects，不拉起 worker，也不写底座 SQLite。要看 `effect` 表，跑下面的检查脚本。

- 默认执行口是 `LocalExecutor`（`packages/dispatcher/src/executor.ts`）。它把派工记在 `.daogang/executor.json`，会话名是 `worker-<ticketId>`。不需要密钥，也不需要 clone 底座。
- `DAOGANG_EXECUTOR=dsh` 且没设 `DAOGANG_DSH_ROOT`：和以前一样，抛出「DSH 未接线」，这次派工落成招领。
- 设了 `DAOGANG_DSH_ROOT`（且没有把执行口显式锁成 `local`）：适配器按路径加载该克隆里的 `DshExecutor`，调用 `start` → `enqueue('launch', assignmentId, { ticketId, assignmentId })`，`deliver` → `enqueue('delivery', ticketId, { ticketId })`。入队记在到岗侧的站位 effects 上。这条路径不打开底座 `Store`，也不进私有 `launch()`。克隆加载失败同样落招领。
- 公开 enqueue 载荷只有 id，放不下卡片。inbox Trigger 把本腿卡片写进 `text` 和 `meta.cards`（标记 `[daogang-cards]`）。上游 `triggerMessage` 读的是 `text`，不读 `meta`。explicit 接单时 `ticketExecution` 把 accept 的 `note` 写进 `execution.assignment`。`inputMessage` 对文本输入原样返回。这三份是私有 `launch()` / `deliverInput()` 才会交给 `sessions.prompt` 的材料。适配器不调用那两个私有方法。`scripts/check-runtime.mjs` 用 stub `sessions` 证明：票数据齐全时，`Effects.start()` 的 handler 会把同一段卡片送进 `sessions.prompt`。那次调用不到真实模型。
- inbox Source 可以按 [packages/inbox-source/README.md](packages/inbox-source/README.md) 用 `file:` 或 `link:` 挂到本机 DSH 克隆，默认 `disabled: true`。本地 `LocalInbox` 仍是 CLI 的接单路径。`configured()` 在空 GitHub 配置下为 false，这一点在上游克隆里核对过；Cordis 整链进程和活 worker Session **未验证**。

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

## 两条路

### 纯外围演示

不设置 `DAOGANG_DSH_ROOT`，也不要 `DAOGANG_EXECUTOR=dsh`。上面的 `pnpm test`、`pnpm dispatch` 和 `bash scripts/demo.sh` 都走这条路。`scripts/demo.sh` 会把执行口锁成 `local` 并清空 `DAOGANG_DSH_ROOT`，避免外壳里已经导出的根目录把演示带进适配器。

### 可选：指向本机 DSH 克隆

底座仓库单独 clone，不要复制进本仓。`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-*` 不是本仓的 dependencies，也不是 peerDependencies（pnpm 会把可选 peer 装进锁文件）。inbox Source 的挂载步骤、默认关闭的补丁，以及无密钥核对了什么，写在 [packages/inbox-source/README.md](packages/inbox-source/README.md)。

```bash
# 终端 A：上游自己的目录，按它的 README 安装依赖。本仓测试不需要这一步。
git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git
cd dsh-superagent-prototype

# 终端 B：本仓
export DAOGANG_DSH_ROOT=/绝对路径/dsh-superagent-prototype
pnpm dispatch -- "帮我补上安装说明"
```

成功时输出里 `executor` 是 `dsh`，回执会话名仍是 `worker-<ticketId>`。这只说明克隆里的 `DshExecutor.start` 对站位 `effects.enqueue('launch', …)` 被调用了。失败时标准输出里有招领行，原因以 `DSH 加载失败` 或 `DSH 未接线` 开头。

插件文件在 `packages/inbox-source/cordis.patch.yml`，默认 `disabled: true`。profile 里另写 `id: daogang-inbox` 且 `disabled: false` 才会启用。入口是 `lib/index.js`。下面几件在无密钥检查里已经对上，细节见 inbox Source 的说明：空 GitHub 配置时 `configured()` 为 false（`repositoryUnset`）；空飞书 CLI 不单独挡住；`SETUP_FIELDS` 没有 `inbox`；Zod schema 能被 `SourceRegistry` 收下，只有 `parse` 的 schema 会被拒。

`dsh@0.2.1-rc.3` 在临时 profile 上试过 `plugin add`（`file:` 与 `link:`）和 `--dump-config`：组合结果里有默认关闭的 `daogang-inbox`。那个 profile 没有启动，也没有装上 dsh-superagent。

克隆已经 `pnpm install` 时，可以无密钥复跑 effect 表和假 orchestrator（不读密钥，`pnpm test` 不跑）：

```bash
DAOGANG_DSH_ROOT=/绝对路径/dsh-superagent-prototype node scripts/check-effects.mjs
```

没设这个变量时脚本说明跳过并退出 0。成功时标准输出是一份 JSON：`effect` 表有 `launch` / `delivery` 且 `attempts` 为 0，`sessionCalls` 为空；`prompt` 三项为 true；`orchestrator.receivedWhenConfigured` 为 true。`runtime.loaded` 取决于 Node：v22.23.4 解析不了 `await using`，所以是 false；v24.22.2 能加载模块，这个脚本仍不构造 Runtime。失败退出非 0，`failed` 字段说明缺什么（常见是克隆还没 `pnpm install`）。打印结果不含绝对路径。

Runtime 构造和 stub `sessions.prompt` 是另一条，同样不读密钥，`pnpm test` 不跑：

```bash
# 退出 0 需要能解析 await using 的 Node。本轮用的是 v24.22.2。
DAOGANG_DSH_ROOT=/绝对路径/dsh-superagent-prototype node scripts/check-runtime.mjs
```

没设变量时退出 0。v24 成功时：`runtime.constructed` 为 true，`healthCode` 是 `setupPending`，`effectsStarted` 为 false；`configured.passed` 为 true，`configured.effectsStarted` 与 `configured.masterEnsure` 为 true，`agentDeliverySend` 为 false；`launch.checked` 为 true，`cardsInAssignment` 与 `cardsInTriggerText` 为 true，`modelCalled` 为 false。configured 这一段用临时库里的 `probe/probe` 和夹具 `subprocess.spawn` 让 `Setup.run` 返回 true，不调用 `gh`。v22.23.4 上 Runtime 与 configured 两段失败、脚本退出非 0，launch 一段仍可通过。细节在 [底座结构笔记 §10](docs/notes/底座结构笔记-2026-11-01.md)。

下面几件仍然 **未验证**：

- 正在跑的 superagent 进程。Runtime 探测用的 webServer 只登记、不监听
- 活的主会话和 `worker-<ticketId>` Session。configured 路径的主会话 `ensure` 是桩，没有 `sessionController`；launch 路径的 stub `sessions.ensure` 也没有创建 DSH Session
- 卡片文本有没有进入一次真实的 worker 模型请求。stub `sessions.prompt` 记下了首条消息，没有调用 `llm`。configured 路径上 `AgentDelivery.send` 是 0 次
- 真实的 `gh` 身份。`configured()===true` 靠夹具 stdout，不是 GitHub 账号

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
- [HostAdapter：对影优先](docs/notes/HostAdapter-对影-2026-11-01.md)

## 许可

[MIT](LICENSE) © 2026 lingze818-maker

本仓库是独立实验，不是 DeepSeek 官方产品。上游原型：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)（MIT）。
