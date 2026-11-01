# HostAdapter

宿主无关的五个动作：`sendMessage`、`openSession`、`interrupt`、`readContext`、`auth`。

默认是 `LocalCliHost`，包住现在的外围 CLI。它不读 `DAOGANG_EXECUTOR`，也不打开 DSH。`pnpm dispatch` 仍然直接走分发器。

`DuiyingHost` 按鎏虹 2026-11-01 的六条口径做本机连通：映射、`auth`、`GET /api/health`、`POST /api/wake`。`sendMessage` 不进窗。说明在 [HostAdapter-对影-2026-11-01.md](../../docs/notes/HostAdapter-对影-2026-11-01.md)。
