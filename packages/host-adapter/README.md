# HostAdapter

宿主无关的五个动作：`sendMessage`、`openSession`、`interrupt`、`readContext`、`auth`。

默认是 `LocalCliHost`，包住现在的外围 CLI。它不读 `DAOGANG_EXECUTOR`，也不打开 DSH。`pnpm dispatch` 仍然直接走分发器。

`DuiyingHost` 按鎏虹六条口径做本机连通，并按对影 PR #59 的形状接进窗（`POST /api/daogang/inject`）和用户话钩子（`/hooks/duiying-user`）。对影尚未合入，测试用 mock。不调用 `/api/chat`。说明在 [HostAdapter-对影-2026-11-01.md](../../docs/notes/HostAdapter-对影-2026-11-01.md)。
