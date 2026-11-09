# 变更日志 · 到岗（daogang）

> 本文件记录「到岗」自 2026-11-02 冲刺周起的全部变更。时间均为 UTC（北京时间 +8），按工作日归档。
> 当前版本：`0.2.0-peripheral`（2026-11-06 灵泽拍板 B；版本号决策见 docs/version-decision-2026-11-06.md）。

## 摘要

三天冲刺把「到岗」从外围演示推进到**端到端闭环 + 全量校核合并**：

- **评测有数（五维全出数）**：D1 关键词基线、D2 Flash 对照与混合裁决、D3 打断恢复三层 12 用例、首响延时真链路、节奏分布单调。
- **混合裁决落地**：Flash 出语义路由，显式节奏词裁 urgency，联合准确率 0.970。
- **跨进程桥**：dispatch CLI 的 Trigger 经 `DAOGANG_HOME/triggers.jsonl` 渡进运行中的 DSH 服务。
- **首个端到端闭环**：一句话派单 → DSH 开票 → worker 起 Session → 自主开出 PR #26。
- **外部审库**：首次异源校核 8 条意见当日全处置。
- **CI 测试门**：GitHub Actions node 22/24 双矩阵 + 构建同步检查。

## 11-02（周六）

### 评测

#### D1 · 关键词路由基线

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

产物：`bench/results-keywords.json`、`bench/results-keywords-all.jsonl`；说明见 `bench/README.md`。

#### D2 · Flash 对照与混合模式

同一数据集逐条走 Flash 路由；100 条全部实走，回落 0 条（对照跑不接受静默回落）。

| 指标 | 关键词兜底 | Flash | 混合（Flash target + 规则 urgency） |
|---|---:|---:|---:|
| target（总体） | 0.690 | **0.970** | 0.970 |
| urgency（总体） | **1.000** | 0.870 | **1.000** |
| target+urgency（总体） | 0.690 | 0.840 | **0.970** |
| target+urgency（task） | 0.880 | 0.920 | **1.000** |
| target+urgency（mixed） | 0.733 | 0.933 | **0.967** |
| target+urgency（trap） | 0.150 | 0.800 | **0.900** |

原始 Flash urgency 数据以 `results-flash.json` 为准（#20 后 CLI 走混合裁决，不再复现原始 Flash urgency）。

#### D3 · 打断恢复（三层 12 用例）

打断语义（急打断/同级排队/FIFO/交接备注 ≤200 字/五字段无损）+ 落盘 roundtrip + 端到端三连，**12/12 全过**。

## 11-02~11-03 · 里程碑

- **首个端到端闭环**：00:12（本地）一句话派单 → DSH 开票 → worker 起 Session → 00:16 worker 自主开出 PR #26。
- **worker 自主产出**：FAQ（#26）、时间线（#27）、CHANGELOG 草稿（#28，内容已被本文件吸收）。

## 11-03 · 外部审库（首次异源校核）

外部审阅者（蜜桃家夏）独立审库：两仓 81+60 测试复跑、边界实验实证，8 条意见**当日全处置**（6 修复 / 1 设计确认 / 1 转达）：

- **对影 PR #10**：`parseFrontmatter` 多行 YAML 列表静默丢弃（`suppress_when` 换行写法失效=沉默条目照常浮出，隐私级）→ 支持续行列表含缩进。
- **对影 PR #11**：ingest 标题单行化（换行压空格+告警）、时间先验不奖未来日期、doctor 子目录 basename 唯一匹配（同根歧义不猜）。
- **到岗 PR #32**：`Board.patch` 读改覆盖写非原子（跨进程并发丢写）→ tmp+rename，与 `WorkerLane.save` 对齐。
- **到岗 PR #33**：`triggers.jsonl` 5MB 轮转 `.1/.2`（阈值参数化）。
- **到岗 PR #36**：外部审库响应清单（本文件的前身）。

审库间接促成：CI 版本断言动态化（版本单一来源）、跨天 flaky 记档。

## 11-04 · 基础设施

- **CI 测试门落地（PR #38）**：GitHub Actions node 22/24 双矩阵 + `build:inbox` 同步检查 + 权限位/行尾忽略——三层迭代（action-setup 双源冲突 / CR 行尾 / fileMode 权限位）。
- **跨宿主适配（PR #30）**：zcode/agent-board 宿主（spawn 真 board.py 保协议原子性），活体闭环（投单→认领→校核→done）。
- **issue #34 破案**：「重启后 accepted 不落」根因=本机 DAOGANG_HOME 路径字符串不同源（非上游 bug），已补结案评论；跨进程文件桥两端须字节级同路径。

## 11-05 · 稳定与固化

- **start-dsh.ps1 一键脚本**：标准咒固化（读 key/杀残留/等锁/后台启动/健康检查），弹窗根源修复（Start-Process Hidden 与 Redirect 同用失效 → cmd 转发）。
- **DSH 环境复活全绿**：面板配置恢复 + 代理 env 修复后 runtime/inbox/github 三线全绿。
- **#34 第二轮数据点**：配置正确重填+重启场景端到端走通（received 4 / accepted 1）——定性修正为「配置不持久化」的下游表现。

## 11-06 · 收口

- **PR 清零**：35 个 PR 全部收编进 main（外部校核+合并完成）。
- **issue #34 结案**：根因=本机路径字符串不同源，非上游 bug。
- 悬而未决：活 Session 的可复现性（依赖 3082 常驻，上课周冻结中）；版本号待拍板。

## 已知边界

- B2 的适配器路径仍半开：DSH 路径仅 enqueue；活 Session / 真模型未验（#34 破案后环境已可复现，待下轮验证）。
- D3 只量打断语义，不含「恢复后继续干」。
- 五维第 5 项（跨会话指代）待上游 threadContext。
- 对影、zcode、Codex 的宿主适配不在本文件范围。

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

注意：#20 之后 `--router flash` 走的是混合裁决（`routeText` 会覆盖 urgency），不再复现 `results-flash.json` 里的原始 Flash urgency；原始对照以 `results-flash.json` 为准。

## 链接

- [评测说明](../bench/README.md)
- [D2 对照表](../bench/compare.md)
- [任务清单](./TASKS.md)
- [底座结构笔记](./notes/底座结构笔记-2026-11-01.md)
- 上游：[deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
