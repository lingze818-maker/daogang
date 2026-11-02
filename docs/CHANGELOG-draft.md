# 变更日志（草稿）· 2026-11-02

> 状态：草稿，未发布。合并状态以各 PR 为准；标「待审」的条目还没有进 `main`。
> 时间均为 UTC，北京时间 +8。11-02 的收尾在本地已跨到 11-03 凌晨，本稿仍按 11-02 工作日归档。

## 摘要

11-02 把「到岗」从外围演示推进到一条能跑通的真实链路：

- **评测有数**：D1 关键词基线、D2 Flash 对照、D3 打断恢复三层 12 用例。
- **混合裁决落地**：Flash 出语义路由，显式节奏词裁 urgency，联合准确率 0.970。
- **跨进程桥**：dispatch CLI 的 Trigger 经 `DAOGANG_HOME/triggers.jsonl` 渡进运行中的 DSH 服务。
- **DSH 测试环境**：`127.0.0.1:3082` 上启用 `daogang-inbox`，与 CLI 共用同一个 `DAOGANG_HOME`。
- **首个端到端闭环**：00:12（本地）一句话派单 → DSH 开票 → worker 起 Session → 00:16 开出 PR #26。

版本号仍是 `0.1.0-peripheral`，没有对外发布；B2 的适配器路径仍半开（见「已知边界」）。

## 评测

### D1 · 关键词路由基线

100 条虚构混合输入（50% 纯任务 / 30% mixed / 20% 路由陷阱），无密钥、无网络可复跑。标签按人的真实意图，不迁就规则。

| 组 | n | target | urgency |
|---|---:|---:|---:|
| task | 50 | 0.880 | 1.000 |
| mixed | 30 | 0.733 | 1.000 |
| trap | 20 | **0.150** | 1.000 |
| **总体** | **100** | **0.690** | **1.000** |

三类盲区（全部错例可复查）：

1. **名词误触发**：吐槽 bug、夸文档、问教程都被名词命中开成工单。
2. **闲聊词表窄**：「早呀 / 哈喽 / 好累 / 麻烦」不在 CHAT 表，问候+任务被降级成纯任务，主窗腿丢失。
3. **祈使无呼语**：没有「帮我 / 麻烦」前缀的祈使句不命中 TASK，被推给主窗。

产物：`bench/results-keywords.json`、`bench/results-keywords-all.jsonl`；说明见 `bench/README.md`。PR #16（已合并）。

### D2 · Flash 对照与混合模式

同一数据集逐条走 Flash 路由；100 条全部实走，回落 0 条（对照跑不接受静默回落）。

| 指标 | 关键词兜底 | Flash | 混合（Flash target + 规则 urgency） |
|---|---:|---:|---:|
| target（总体） | 0.690 | **0.970** | —（target 仍信 Flash） |
| urgency（总体） | **1.000** | 0.870 | 1.000（规则） |
| target+urgency（总体） | 0.690 | 0.840 | **0.970** |
| target+urgency（task） | 0.880 | 0.920 | **1.000** |
| target+urgency（mixed） | 0.733 | 0.933 | **0.967** |
| target+urgency（trap） | 0.150 | 0.800 | **0.900** |

判读：

- target 总体 0.690 → 0.970；trap 组 0.150 → 0.900，D1 的三类盲区被 Flash 解掉大半。
- urgency 反过来：规则 1.000 > Flash 0.870。Flash 的 13 个 urgency 错分里，坏消息报障判 2、纯吐槽判 0 都语义可辩护，但标签以显式节奏词为准，没有迁就模型。
- 因此不选「全信 Flash」，选混合：语义路由（target/cards）信 Flash，节奏（urgency）信规则词表。

产物：`bench/compare.md`、`bench/results-flash.json`、`bench/results-flash-all.jsonl`；PR #18（runner/对照表）、#19（结果）已合并。

### D3 · 打断恢复

12 个用例三层，无密钥无网络，`pass_rate 1.000`：

| 层 | 用例 | 覆盖 |
|---|---|---|
| 纯函数（assignTask） | u01–u10 | 空闲接单 / 同级不打断 / 低不打高 / 高打断低 / 打断后 FIFO / 队中多单排尾 / 交接备注 ≤200（含 clamp）/ 被打断工单五字段无损 |
| 落盘恢复（WorkerLane） | r01 | 打断后 save→load 全等 |
| 端到端（dispatchLine） | e01 | 普通→急 mixed→不急 三连：看板与备注正确 |

边界：本套量的是「打断语义正确性」（谁被打断、去哪、备注什么、信息丢没丢），不含「恢复后继续干」——那需要活的 worker Session，等 B2 后续追加。PR #17（已合并），明细 `bench/results-d3.json`。

## 混合裁决

- **决策**（灵泽 2026-11-02 拍板，D2 数据支撑）：target/cards 信 Flash，urgency 信显式节奏词规则。
- **实现**：`packages/dispatcher/src/route.ts` 的 `routeText` 在 Flash 返回可用 decision 后，用 `urgencyOf(text)` 覆盖 urgency；Flash 失败或结果不可用才整条回落关键词。
- **联合准确率 0.970**：task 1.000 / mixed 0.967 / trap 0.900（见上表）。
- **文案**：PR #20 把「urgency 被节奏词覆盖」和「落规则默认」分开写；PR #22 进一步区分「节奏词裁决 / 规则默认 / 普通 Flash 路由」，待审。

## 跨进程桥

**问题**：dispatch CLI 与 DSH 服务是两个进程。`LocalInbox` 只落接单回执，DSH 进程里的 feed 是纯内存队列，trigger 送不进去（issue #24）。

**方案（文件桥）**：

- 新增 `packages/inbox-source/src/trigger-log.ts`：
  - `appendTrigger`：dispatcher 接单成功后追加 `DAOGANG_HOME/triggers.jsonl`（append-only，一行一个 trigger）。
  - `watchTriggerLog`：DSH 侧轮询 tail（默认 1s），按 id 去重、坏行跳过、可停、abort 安全。
- `packages/dispatcher/src/run.ts`：chat/task 两腿只在 `accepted` 后 append；duplicate 不重发。
- `packages/inbox-source/src/plugin.ts`：`apply` 在 `DAOGANG_HOME` 存在时起 watch，把新 trigger push 进内存 feed。
- actor 对齐 DSH Policy 名单：`cli-user` → `cli`（explicit sender）。

**验证**：

- 组件单测覆盖增量、去重、停止后不收、坏行跳过、往返一致。
- 真机：22:21（本地）dispatch 一句 → `triggers.jsonl` 落盘 → inbox source health 转 `ready`、detail 为 trigger id，DSH 服务真消费到了 CLI 的 trigger。
- 23:17（本地）actor 对齐提交后，下一条 trigger（00:12）被评估器收成工单（见下一节）。

**状态**：PR #25（待审，未合并）。

## DSH 测试环境

- 专用测试环境，Web `127.0.0.1:3082`；`stateDir` 指向 `~/.dsh/state/superagent`；默认模型 `deepseek-flash`。
- 到岗 inbox Source 以 `@daogang/inbox-source` 挂入 profile，2026-11-02 21:10（本地）激活；`daogang-inbox` 打开。
- Policy 名单预置 `cli` 行；dispatch 侧 actor 也写成 `cli`，两边对齐。
- CLI 与 DSH 服务共用 `DAOGANG_HOME`，桥的触发文件落在同一目录。
- Runtime 探测需要 Node 24+（v22.23.4 解析不了 `await using`；v24.22.2 能构造 `Runtime`）。本环境用 Node 24。
- 本稿所在的 worker Session（`worker-10637…`）就跑在这个环境里。

## 里程碑：首个端到端闭环

链路：

```
dispatch CLI → DAOGANG_HOME/triggers.jsonl → DSH inbox source
  → 评估器收成 Ticket → worker Session → PR
```

时间线（UTC）：

| 时间 | 事件 |
|---|---|
| 16:12:13.888 | CLI 派单：「帮我在 README 末尾补一节常见问题」 |
| 16:12:17.550 | DSH 开出第一张工单 `fd315f6f…` |
| 16:12:17.729 | `worker-fd315f6f…` Session 启动 |
| 16:16:21 | worker 开出 PR #26（README「常见问题」） |
| 16:17:53 | PR #26 的 CI 结果回到工单 |

这是第一次不用手工搬 trigger、也不用适配器站位 effects，走完「一句话 → 工单 → worker → PR」。PR #26 待审；工单结束时记录为「PR 维持待人工审阅」。

同一晚 17:11（UTC）又跑了一组 5 条闲聊 + 2 条任务：

- 5 条闲聊都走主窗（`main-stub`），没有开工单；
- 2 条任务分别开成 `5bdfaac1…`（闭环时间线笔记）和 `10637edc…`（本稿）两个工单。

真链路首响（本机实测，原始数据未入库）：

- 闲聊：dispatch P50 897ms、最大 993ms；
- 任务：dispatch 951–1331ms；从 dispatch 返回到观测到 DSH `flow.accepted` 增量 4.06–4.07s（桥 1s 轮询 + 评估，观测本身按 2s 轮询），端到端约 5.0–5.4s。
- 结论：闲聊首响 <1s；任务收单的观测上限约 5 秒，实际时刻受 2s 观测粒度限制，尚不能据此判定是否满足 p95 <3s 的门槛。下一步把观测粒度和桥轮询一起收紧。

## 修复

- PR #15（已合并）：三处 Windows 兼容——测试路径断言、对影隔离、夹具 argv 基名。
- PR #25 顺带修 `scripts/rewrite-inbox-dts.mjs` 的 Windows bug：`URL.pathname` 在 Windows 是 `/C:/...`，改用 `fileURLToPath`。

## 合并状态

| PR / Issue | 内容 | 状态 |
|---|---|---|
| [#15](https://github.com/lingze818-maker/daogang/pull/15) | Windows 兼容修复 | 已合并 |
| [#16](https://github.com/lingze818-maker/daogang/pull/16) | D1 mini-bench | 已合并 |
| [#17](https://github.com/lingze818-maker/daogang/pull/17) | D3 打断恢复 12 用例 | 已合并 |
| [#18](https://github.com/lingze818-maker/daogang/pull/18) | D2 runner + 对照表 | 已合并 |
| [#19](https://github.com/lingze818-maker/daogang/pull/19) | D2 Flash 结果 + 混合模式 | 已合并 |
| [#20](https://github.com/lingze818-maker/daogang/pull/20) | 混合裁决 urgency 覆盖 | 已合并 |
| [#21](https://github.com/lingze818-maker/daogang/pull/21) | README 状态节入库 D1/D2/D3 数字 | 待审 |
| [#22](https://github.com/lingze818-maker/daogang/pull/22) | 混合裁决 reason 分文案 | 待审 |
| [#23](https://github.com/lingze818-maker/daogang/pull/23) | B6 终端录屏 → GIF | 待审 |
| [#25](https://github.com/lingze818-maker/daogang/pull/25) | inbox 跨进程桥 | 待审 |
| [#26](https://github.com/lingze818-maker/daogang/pull/26) | README 常见问题（首个闭环产出） | 待审 |
| [#24](https://github.com/lingze818-maker/daogang/issues/24) | 跨进程桥 issue | 开着 |

## 已知边界

- B2 仍半开：`DAOGANG_DSH_ROOT` 适配器只把 `start`/`deliver` 的 enqueue 记到站位 effects，不拉起 worker；`Runtime.initialize` 的主会话 `ensure` 仍是桩。
- `SessionController` 公开插件硬挡；`SessionStore.create` 能得到同一 `masterId` 的内存 `Session`，但没有 `sessionController` 管的活 Agent，也没有真实模型请求（11-02 探测）。
- 桥这条链路已经有活 worker（本节 PR #26 与两个工单）；适配器那条还没有。
- 跨进程桥 PR #25 的提交删除了 `src/plugin.ts`，而 `src/index.ts` 仍有 `./plugin.ts` 导出；合并前需修复（测试环境工作区版本是完整的）。
- D3 只量打断语义，不含「恢复后继续干」；「即时到场」的真链路数字尚未入库。
- 对影、zcode、Codex 的宿主适配不在本稿范围。

## 复跑

```bash
pnpm test

# D1 关键词基线（无密钥）
node --experimental-strip-types bench/run-bench.mjs

# D2 对照（需要 DEEPSEEK_API_KEY）
DEEPSEEK_API_KEY=... node --experimental-strip-types bench/run-bench.mjs --router flash
node --experimental-strip-types bench/compare.mjs

# D3
node --experimental-strip-types bench/run-d3.mjs
```

注意：`#20` 之后 `--router flash` 走的是混合裁决（`routeText` 会覆盖 urgency），不再复现 `results-flash.json` 里的原始 Flash urgency；原始对照以 `results-flash.json` 为准。

## 链接

- [评测说明](../bench/README.md)
- [D2 对照表](../bench/compare.md)
- [任务清单](./TASKS.md)
- [底座结构笔记](./notes/底座结构笔记-2026-11-01.md)
- 上游：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
