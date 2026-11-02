# D2 · 关键词兜底 vs Flash 路由（同一数据集 100 条）

_keywords: 2026-11-02T04:48:50.176Z · flash: 待跑（需 DEEPSEEK_API_KEY）_

| 指标 | 关键词兜底 | Flash 路由 |
|---|---|---|
| target 准确率（总体） | 0.690 | —（待 flash 跑） |
| urgency 准确率（总体） | 1.000 | —（待 flash 跑） |
| target+urgency（总体） | 0.690 | —（待 flash 跑） |
| target 准确率（task） | 0.880 (n=50) | —（待 flash 跑） |
| target 准确率（mixed） | 0.733 (n=30) | —（待 flash 跑） |
| target 准确率（trap） | 0.150 (n=20) | —（待 flash 跑） |

## 跑法（额度恢复后）

```bash
export DEEPSEEK_API_KEY=<key>
node --experimental-strip-types bench/run-bench.mjs --router flash
node --experimental-strip-types bench/compare.mjs   # 重新生成本表
```

焦点看 trap 组：关键词 0.15（D1 实测），Flash 若显著更高，"小模型路由+关键词兜底"双层设计即有数据支撑。
