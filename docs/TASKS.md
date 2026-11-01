# 「到岗」任务清单

_目标：尽快可用版 → 再做成可挂宿主的通用插件（优先级：对影 > zcode > Codex）_
_主责：鎏涟 · 更新：2026-11-02（B2：Runtime 空配置与 stub launch；此前 effect 表与公开 prompt 层；C1 挂载路径；对影 #59 真调）_

## 总路线

1. **MVP 可用版**（本机/CLI 能演示：一句话派活、秒级到岗、打断可恢复）
2. **对照评测 + 拟人五维有数**（实时分发 vs 招领基线。底座默认的 candidate 批量评估就是招领基线）
3. **通用插件层**（宿主无关的分发/看板协议；适配顺序：对影 > zcode > Codex）

---

## 阶段 A · 底座摸清（约 1–2 天）— 已完成

> **纠正：** 底座实际为 **TypeScript / pnpm / DeepSeek Harness（Cordis）**，不是 Python；扩展正路是 **Source 插件 + 外围分发器**，没有 bridge。Worker 是一票一个 Ticket Session，不是 3 个长驻角色进程。详见 [notes/底座结构笔记-2026-11-01.md](./notes/底座结构笔记-2026-11-01.md) 与 [notes/MVP边界-外围分发器-2026-11-01.md](./notes/MVP边界-外围分发器-2026-11-01.md)。

- [x] A1 确认 dsh-superagent-prototype 仓库地址与 license（MIT；**未 clone**，远程读完毕；本地开发环境 clone 待建仓后按需）
- [x] A2 读 session / 插件 / Source 入站路径：标出「实时唤醒 worker」扩展点（Source + Assignment/launch）
- [x] A3 写《底座结构笔记》（短）：接口清单、可挂点、不能碰的内部类
- [x] A4 定 MVP 边界：单用户输入流、SQLite 审计看板；worker 按 Ticket Session（不是 3 个长驻角色进程）。结论写入笔记 §5

**笔记路径：** [notes/底座结构笔记-2026-11-01.md](./notes/底座结构笔记-2026-11-01.md)

**完成标准：** 笔记已落盘；已指出「派单进、会话起」钩子：① inbox `SourceContext.receive` / `Passes.receive`；② `Tickets`→`DshExecutor.start` / Effects `launch`·`delivery`。上游 Issues 关闭，待验证项记在笔记 §7。

## 阶段 B · 实时分发 MVP（约 4–6 天）— 可用版核心

**外围可用版 `0.1.0-peripheral`：** `pnpm dispatch`、主窗桩、本地打断、招领和 `bash scripts/demo.sh` 可以无密钥、无 DSH 安装演示。执行口默认 `LocalExecutor`。设了 `DAOGANG_DSH_ROOT` 时，`DshExecutorAdapter` 按路径调用克隆里的 `start`→`enqueue('launch')` 与 `deliver`→`enqueue('delivery')`；没设时仍是未接线并落招领。适配器用的是站位 effects，不写底座 SQLite。要看 `effect` 表里的行，跑 `scripts/check-effects.mjs`。真 worker Session 不起。GIF 先不做。

- [x] B1 分发器常驻进程：输入 → `{target, urgency, cards}`（Flash 路由 + 关键词兜底）
- [ ] B2 角色路由到 Ticket Session：派单后由底座 Assignment 起 `worker-<ticketId>` Session，按卡片注入上下文（产品层可保留多个角色，不是 3 个长驻进程）。**默认 Local。** `LocalExecutor` 按卡片记下派工。可选 `DAOGANG_DSH_ROOT`（或 `DAOGANG_EXECUTOR=dsh` 且给出该根）时，适配器动态加载克隆里的 `DshExecutor`，只调用公开的 `start` / `deliver`，确认 enqueue 了 `launch` / `delivery`。未设置根目录时抛未接线并落招领。`pnpm test` 不装 dsh、不读这个变量。还没有活的 worker Session。适配器里的 effects 仍是站位，不写底座 SQLite，也不进私有 `launch()`。公开 enqueue 载荷只有 `ticketId` 和 `assignmentId`，放不下卡片。**2026-11-02** 在上游 `6337fc8` 上无密钥跑过 `scripts/check-effects.mjs`（克隆已 `pnpm install`；没设根目录则跳过并退出 0）：用公开的 `Store` 加未调用 `start()` 的 `Effects` 接上 `DshExecutor.start` / `deliver`，临时库 `effect` 表留下 `launch` 与 `delivery`，`attempts` 为 0，`sessions.prompt` 没有被调用。不调用 `Effects.start()` 是故意的：handler 一跑，没有对应 pending Assignment 的行会被删掉；票数据齐全时则会进入私有 `launch()`。写这张表不需要 Cordis / Runtime。卡片进首条 worker 消息的公开层是 `triggerMessage` 读的 Trigger.`text`（不读 `meta`）、explicit 时 `ticketExecution` 把 accept `note` 写进的 `execution.assignment`，以及 `inputMessage` 对 `kind: 'text'` 原样返回的正文。inbox 把本腿卡片写进 `text` 和 `meta.cards`（标记 `[daogang-cards]`）。探测确认这三段经上述公开函数后仍含卡片摘要。私有 `launch()` / `deliverInput()` 才调用 `sessions.prompt`。`check-effects.mjs` 不调用它们。**同一天续跑 `scripts/check-runtime.mjs`（上游仍是 `6337fc8`，无密钥，合成夹具 `probe` / `probe-card`，不进真实对话）：** 默认 Node v22.23.4 解析不了 `delivery.ts` 的 `await using`（`--js-explicit-resource-management` 也过不了 ESM），所以 Runtime 一段失败并退出非 0。v24.22.2 能 import 并构造 `Runtime`：空 GitHub 配置下 `configured()` 为 false，健康是 `setupPending` / `repositoryUnset`，`effects.start()` 与 `sessions.ensure` 都是 0 次。webServer 是 `127.0.0.1` 的登记桩，不监听。另用公开 `Store` 写入 pending Assignment、`ticketExecution` 的 note 和已存在的 workspace，不 import `Engine`。`Effects.start()` 之后 handler 进入私有 `launch()`，stub `sessions.ensure` 得到 `worker-<ticketId>`，stub `sessions.prompt` 的 `assignment` 与 `trigger.text` 仍含 `[daogang-cards]`。没有模型请求。活 Session 仍然没有
- [x] B3 mixed 双投：闲聊回主窗 + 任务立案，互不阻塞。主窗是本地 `main-stub`，不是底座 Channel
- [x] B4 打断与快照：高优先级打断低优先级；看板留 ≤200 字交接备注。旧工单留在本地队列里，没有单独的 resume 命令，也没有回到 DSH
- [x] B5 分发失败自动落板：目标离线/超时 → 转招领安全网。触发的是本地 receive 失败（含演示开关），不是底座超时探测
- [ ] B6 Demo：README + GIF（说一句话，另一窗口立刻亮）。GIF 先不做。终端脚本是 `scripts/demo.sh`，记录在 `docs/demo/peripheral.cast`

**完成标准（可用版门槛）：** 本地 CLI 可跑；派单→首响可感秒级；至少演示打断一次并恢复。

## 阶段 C · 挂上 dsh-superagent（约 3–5 天）

- [ ] C1 分发器做成 Source 插件或外围服务（Panel 只作运维面，不引入 bridge）。**第一步（挂载路径，2026-11-02）：** `packages/inbox-source` 按 cookbook 用 `file:` 或 `link:` 挂到本机 DSH 克隆，默认 `disabled: true`，入口是 `lib/index.js`。说明在该包 README。无密钥已核对：包能被 `file:` / `link:` 解析；`dsh@0.2.1-rc.3` 对临时 web profile 的 `plugin add`（先 `file:` 再 `link:`）成功，`--dump-config` 组合出 `daogang-inbox` 且 `disabled: true`，进程没启动、profile 里没有 dsh-superagent；Cordis loader 在 `disabled: true` 时不加载、打开后会 `register`，且 `configured() === false` 时只报 `setupPending`；克隆里的 `SourceRegistry` 接受 Zod schema，拒绝只有 `parse` 的 schema；`Setup.configured()` 在没有 GitHub 仓库时为 false。没有活 Session。复跑：`DAOGANG_DSH_ROOT=<克隆> node scripts/check-inbox-attach.mjs`（不读密钥；`pnpm test` 不跑这一段）。**同一天补了一段假 orchestrator：** `scripts/check-effects.mjs` 用克隆里的 Cordis `Context.plugin`（不是 plugin-loader 读补丁，也不是 `Runtime`）加载本插件。`configured()` 为 false 时只报 `setupPending` 且不 `receive`；为 true 时 `receive` 拿到带卡片的 Trigger。`cordis.patch.yml` 仍是 `disabled: true`。**同一天 `scripts/check-runtime.mjs`：** v22.23.4 仍加载不了 `src/app/runtime.ts`（`await using`）。v24.22.2 能构造 `Runtime`；空 GitHub 配置停在 `setupPending`，不调用 `effects.start()`。这是 Cordis `Context` 加 loopback 登记桩，不是正在跑的 superagent 进程，也没有活 Session
- [ ] C2 独立 repo 或 PR；打 `dsh-superagent` topic
- [ ] C3 若底座接口不稳：降级为「兼容 dsh 的独立工具」，不阻塞阶段 D

**完成标准：** 在 dsh 生态路径上可安装/启动；或明确降级说明进 README。

## 阶段 D · 评测与叙事（约 4–5 天）

- [ ] D1 mini-bench：100 条（50% 纯任务 / 30% mixed / 20% 路由陷阱）
- [ ] D2 同 bench 跑实时分发 vs 招领；出对比表 + 混合模式。原生模式（candidate 批量评估 + attach / `handed_back`）即招领基线，不必另造一套。见结构笔记 §9
- [ ] D3 拟人五维出数：即时到场、接打断、走神回来、节奏分布、跨会话指代
- [ ] D4 博客草稿（标题偏人味，工作室案例脱敏开场）

**完成标准：** 复跑脚本+原始数据进仓；p95 首响 < 3s；漏单不劣于招领。

## 阶段 E · 通用插件（可用版之后）

> 宿主无关协议先定，再写适配器，避免绑死本家。
> **宿主优先级（灵泽 2026-11-01）：对影 > zcode > Codex；对影适配与鎏虹协调。**

- [-] E1 定义宿主适配接口：`HostAdapter`（发消息 / 开会话 / 打断 / 读上下文 / 鉴权）。**部分完成：** 接口和 `LocalCliHost` 在 `packages/host-adapter`，默认仍是本地 CLI。对影口径已按鎏虹 2026-11-01（对影 main `5662082`）写进 [notes/HostAdapter-对影-2026-11-01.md](./notes/HostAdapter-对影-2026-11-01.md)。进窗与用户话钩子按对影 #59 的形状接线。#59 已合入对影 main。本机 loopback 真调通过（2026-11-02）：inject 得到 `dg-` delivery_key；`/hooks/duiying-user` 正确 secret 200、错 secret 401。
- [ ] E2 抽出核心包：`dispatcher` + `board` + `worker-runtime`（与 UI/CLI 解耦）
- [-] E3 **对影（duiying）适配器**：映射、`auth`、`health` / `wake`、打断另开、安全 `readContext` 已在 `DuiyingHost`。进窗 `POST /api/daogang/inject` 与用户话钩子 `/hooks/duiying-user` 按对影 #59 的形状接线。#59 已合入对影 main。本机 loopback 真调通过（2026-11-02）：inject 得到 `dg-` delivery_key；正确 secret 200、错 secret 401。不调 `/api/chat`
- [ ] E4 **zcode 适配器**（灵泽日常环境）
- [ ] E5 **Codex 适配器**
- [ ] E6 插件安装说明 + 最小配置样例（各宿主一份）
- [-] E7 回归：对影连通证明的 happy path 在 `packages/host-adapter` 单测里（mock 本机 HTTP，不打真对影、不烧 Key）。mini-bench 跨宿主还没有

**完成标准：** 第三方仓能按文档步骤装上（pnpm/npm，或当时选定的安装方式）；换宿主不改核心分发逻辑。

## 阶段 F · 作品集包装（约 1 天）

- [ ] F1 作品集条目：链接 + 博客 + 200 字陈述
- [ ] F2 简历一句话定稿（人味在简历，机制在 README）
- [ ] F3 与鎏璟同步作品集 Page 是否收录

---

## 并行杂项（随时）

- [x] G1 GitHub 建仓 + README / LICENSE(MIT) / .gitignore（建仓时只有文档；阶段 B 脚手架在 `packages/`）
- [ ] G2 交接目录 `/workspace/projects/daogang/README.md` 每阶段更新
- [ ] G3 不可逆操作（公开仓、删仓、force-push）先问灵泽
- [ ] G4 真实对话样本永不进仓

## 建议开工顺序（本周）

1. ~~G1 建仓~~ 文档引导已进仓；阶段 B 脚手架在 `packages/`
2. ~~A1–A4~~ 已完成
3. 外围可用版已能演示派单、主窗桩、打断和招领。B2 仍半开：默认 `LocalExecutor`；适配器的 enqueue 仍是站位。设了 `DAOGANG_DSH_ROOT` 时可跑 `scripts/check-effects.mjs`（effect 行与公开 prompt 文本）和 `scripts/check-runtime.mjs`（空配置 Runtime 停在 `setupPending`；stub `sessions.prompt` 含卡片）。没有活 Session，也没有真实模型请求
4. B6 的 GIF 先不做；终端记录在 `docs/demo/peripheral.cast`
5. E1 接口在 `packages/host-adapter`（默认 Local）。对影 #59 已合入，进窗和用户话的 loopback 真调已通过。完整跨宿主适配仍和 C 并行。C1 的挂载说明已可按步骤做。假 orchestrator 的 `receive` 已在 Cordis Context 上对过。空配置的 `Runtime` 在 Node 24 上能构造并停在 `setupPending`。活 Session、真实 webServer 和模型请求还没有
