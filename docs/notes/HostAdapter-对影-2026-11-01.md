# HostAdapter · 对影口径

_到岗 · 2026-11-01_
_口径来源：鎏虹（对影主责），对影主仓 main `5662082`。不是到岗侧的猜测。_
_公开说明。没有密钥、没有真实 peer、没有私人目录。_

## 已经对齐的六条

1. **消息入口。** 第一宿主对接走本机 HTTP，不把现状说成已经有窗口协议。对影现在是：浏览器前端自己持有 messages，`POST /api/chat`（流式）；另有 `POST /api/wake`（只拼人格和 Skill，不调 LLM）、`POST /api/im/chat`（渠道 + peer_id，头 `X-IM-Secret`，默认关）。默认基址 `http://127.0.0.1:8765`，可改，但只接受 loopback。到岗→对影这一期只做旁路连通（`GET /api/health`、`POST /api/wake`）。对影→到岗没有钩子，分发仍用 LocalCli。
2. **会话标识。** `/api/chat` 没有 session_id。状态是客户端的 messages[] 加上 `mode: "companion" | "dev"`。IM 侧是 `{channel}:{peer_id}`。`worker-<ticketId>` 不能当作对影会话名。到岗继续用这个名字；对影侧用到岗维护的映射：ticketId → { mode，可选 channel / peer，或本地 delivery 键 }。`openSession` 只写这张表，不假定对影拉起了进程或会话对象。
3. **打断。** 对影没有 interrupt / cancel。第一期 interrupt 是另开一条（新的 worker 映射），不抢当前窗。不超过 200 字的交接备注只写到岗的 board / worker，和 LocalCli 一样，不写对影 `data/logs`，也不写记忆库。
4. **readContext。** 可以给出：sessionId、mode、工单摘要、handoffNote、最近一句的角色和截断正文。没有摘要就返回空字符串。禁止进入公开仓和到岗日志的有：逐字对话全文、`data/memory`、`user-preference-*`、guard / finetune、真实 peer_id、API Key、本机私人目录的绝对路径。wake 的响应不回灌进上下文。
5. **鉴权。** 不读对影 `.env` 里的模型 Key。`auth` 用到岗自己的本机共享 secret：环境变量 `DAOGANG_DUIYING_SECRET`，或到岗目录里的 `duiying.local.json`（只有 `secret` 字段）。没配是 `unconfigured`；配好是 `anonymous`（本机 loopback + 这份 secret）。凭证和样例不进公开仓。`/api/im/chat` 这一期不调用，所以连通请求不带头。
6. **E7 连通证明（不改对影，也不打 `/api/chat`）。** 本机对影已起时 `GET /api/health` 为 200；secret 配好后 `auth()` 不再是未配置；`openSession({ kind: "worker", ticketId })` 返回 `worker-<ticketId>` 并只写映射；`POST /api/wake`（`mode: "dev"`，短 `text`，`skip_memory: true`）为 200；`readContext` 读映射里的摘要和已有或为空的 handoffNote；`interrupt` 把交接写到到岗侧，`nowSessionId` 指向新的 worker 映射。

wake 的 JSON 就这三件：`mode`、`text`、`skip_memory`。字段名按上面的口径写。若对影实现用了别的键，等对影 PR 改到岗这一处，不另猜路径。

## 代码里怎么对应

| 方法 | 行为 |
| --- | --- |
| `checkHealth` | `GET /api/health`。连不上或不是 200，抛 `DuiyingLinkError`，不带本机绝对路径 |
| `proveWake` | 先要有到岗 secret，再 `POST /api/wake`。不保存响应 |
| `sendMessage` | 拒绝。这不是进窗 |
| `openSession` | 只写 `duiying-map.json` |
| `interrupt` | 到岗 board / worker 与 LocalCli 相同，并登记新映射。不请求对影 |
| `readContext` | 摘要、mode、交接、可选的截断一句。不返回 peer、channel、wake 正文 |
| `auth` | 看得到到岗 secret 才是 `anonymous` |

`createHost()` 默认仍是 `local-cli`。`pnpm dispatch` 不经过这个包。

## 仍等灵泽

下面两项这一仓不做，等灵泽拍板后由对影侧开 PR：

1. **进窗注入。** 让到岗的一句真正出现在对影窗口里。现状没有这个入口，`sendMessage` 保持拒绝。
2. **用户话进分发。** 对影里的一句怎么交到到岗分发器。现状没有钩子，分发继续走 LocalCli。
