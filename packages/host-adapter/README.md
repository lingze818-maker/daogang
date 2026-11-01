# HostAdapter

宿主无关的五个动作：`sendMessage`、`openSession`、`interrupt`、`readContext`、`auth`。

默认是 `LocalCliHost`，包住现在的外围 CLI。它不读 `DAOGANG_EXECUTOR`，也不打开 DSH。`pnpm dispatch` 仍然直接走分发器。

`DuiyingHost` 按鎏虹六条口径做本机连通，并按对影 #59 的形状接进窗（`POST /api/daogang/inject`）和用户话钩子（`/hooks/duiying-user`）。#59 已合入对影 main。本机 loopback 真调通过：inject 得到 `dg-` delivery_key；正确 secret 200、错 secret 401。仓内测试仍用 mock。不调用 `/api/chat`。说明在 [HostAdapter-对影-2026-11-01.md](../../docs/notes/HostAdapter-对影-2026-11-01.md)。
