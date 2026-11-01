# HostAdapter

宿主无关的五个动作：`sendMessage`、`openSession`、`interrupt`、`readContext`、`auth`。

默认是 `LocalCliHost`，包住现在的外围 CLI（主窗桩、`worker-<ticketId>`、更高优先级才打断、本地执行口）。它不读 `DAOGANG_EXECUTOR`，也不打开 DSH。`pnpm dispatch` 仍然直接走分发器。

`DuiyingHost` 是给对影留的桩，和鎏虹对齐前不访问网络。问题记在 [HostAdapter-对影-2026-11-01.md](../../docs/notes/HostAdapter-对影-2026-11-01.md)。
