# HostAdapter · 对影口径

_到岗 · 2026-11-01_
_口径来源：鎏虹（对影主责），对影主仓 main `5662082`。不是到岗侧的猜测。_
_公开说明。没有密钥、没有真实 peer、没有私人目录。_

## 已经对齐的六条

1. **消息入口。** 第一宿主对接走本机 HTTP，不把现状说成已经有窗口协议。对影现在是：浏览器前端自己持有 messages，`POST /api/chat`（流式）；另有 `POST /api/wake`（只拼人格和 Skill，不调 LLM）、`POST /api/im/chat`（渠道 + peer_id，头 `X-IM-Secret`，默认关）。默认基址 `http://127.0.0.1:8765`，可改，但只接受 loopback。连通证明仍是 `GET /api/health` 与 `POST /api/wake`。进窗与用户话按对影 [PR #59](https://github.com/lingze818-maker/duiying/pull/59) 的形状接线。该 PR 已合入对影 main。2026-11-02 本机 loopback 真调通过：inject 得到 `dg-` delivery_key；`/hooks/duiying-user` 正确 secret 200、错 secret 401。分发入口是外围 `dispatchLine`，不调用 `/api/chat`。
2. **会话标识。** `/api/chat` 没有 session_id。状态是客户端的 messages[] 加上 `mode: "companion" | "dev"`。IM 侧是 `{channel}:{peer_id}`。`worker-<ticketId>` 不能当作对影会话名。到岗继续用这个名字；对影侧用到岗维护的映射：ticketId → { mode，可选 channel / peer，或本地 delivery 键 }。`openSession` 只写这张表，不假定对影拉起了进程或会话对象。
3. **打断。** 对影没有 interrupt / cancel。第一期 interrupt 是另开一条（新的 worker 映射），不抢当前窗。不超过 200 字的交接备注只写到岗的 board / worker，和 LocalCli 一样，不写对影 `data/logs`，也不写记忆库。底座全库同样没有 interrupt；高优打断低优仍由外围分发器做，见结构笔记 §9。
4. **readContext。** 可以给出：sessionId、mode、工单摘要、handoffNote、最近一句的角色和截断正文。没有摘要就返回空字符串。禁止进入公开仓和到岗日志的有：逐字对话全文、`data/memory`、`user-preference-*`、guard / finetune、真实 peer_id、API Key、本机私人目录的绝对路径。wake 的响应不回灌进上下文。
5. **鉴权。** 不读对影 `.env` 里的模型 Key。`auth` 用到岗自己的本机共享 secret：环境变量 `DAOGANG_DUIYING_SECRET`，或到岗目录里的 `duiying.local.json`（只有 `secret` 字段）。没配是 `unconfigured`；配好是 `anonymous`（本机 loopback + 这份 secret）。凭证和样例不进公开仓。`/api/im/chat` 这一期不调用，所以连通请求不带头。
6. **E7 连通证明（不改对影，也不打 `/api/chat`）。** 本机对影已起时 `GET /api/health` 为 200；secret 配好后 `auth()` 不再是未配置；`openSession({ kind: "worker", ticketId })` 返回 `worker-<ticketId>` 并只写映射；`POST /api/wake`（`mode: "dev"`，短 `text`，`skip_memory: true`）为 200；`readContext` 读映射里的摘要和已有或为空的 handoffNote；`interrupt` 把交接写到到岗侧，`nowSessionId` 指向新的 worker 映射。

wake 的 JSON 就这三件：`mode`、`text`、`skip_memory`。字段名按上面的口径写。#59 合入后的 loopback 真调按这组字段通过。

## 代码里怎么对应

| 方法 | 行为 |
| --- | --- |
| `checkHealth` | `GET /api/health`。连不上或不是 200，抛 `DuiyingLinkError`，不带本机绝对路径 |
| `proveWake` | 先要有到岗 secret，再 `POST /api/wake`。不保存响应 |
| `sendMessage` | `POST /api/daogang/inject`，头 `X-Daogang-Secret`。200 只收 `delivery_key`、`text`、`at`，并把 `dg-` 键写回映射。401 / 503 是明确错误 |
| `openSession` | 只写 `duiying-map.json` |
| `interrupt` | 到岗 board / worker 与 LocalCli 相同，并登记新映射。不请求对影 |
| `readContext` | 摘要、mode、交接、可选的截断一句。不返回 peer、channel、wake 正文 |
| `auth` | 看得到到岗 secret 才是 `anonymous` |

`createHost()` 默认仍是 `local-cli`。`pnpm dispatch` 不经过这个包。

## 进窗与用户话（对影 #59，已合入）

灵泽已拍板做这两项。到岗按 `docs/daogang-接线.md` 的形状接好了。#59 已合入对影 main。2026-11-02 本机 loopback 真调通过：`POST /api/daogang/inject` 返回 `dg-` 开头的 `delivery_key`；`/hooks/duiying-user` 在 secret 正确时 200，错误时 401。下面只记公开的请求形状，不记对话正文。

1. **进窗。** `POST {base}/api/daogang/inject`。头是 `Content-Type: application/json` 和 `X-Daogang-Secret`（到岗自己的 secret，不读对影模型 Key）。body 有 `text`、`worker_ref`（到岗的 `worker-<ticketId>`，对影收下即弃）、映射上的 `mode`。只有映射里的 `deliveryKey` 已经以 `dg-` 开头才带 `delivery_key`。成功响应只有 `delivery_key`、`text`、`at`。返回的键写回映射，换掉 `worker-*` 占位。给 HostAdapter 的消息仍用原来的 `sessionId`。对影 503 是未启用或缺 secret，401 是 secret 不对或没带头。
2. **用户话钩子。** 到岗在 loopback 上提供 `POST /hooks/duiying-user`（默认端口 `8787`，可用 `DAOGANG_DUIYING_HOOK_PORT` 改）。默认关闭，`DAOGANG_DUIYING_HOOK=1` 或 `duiying.local.json` 里 `"hook": true` 才听。对影把 `daogang.callback_url` 指到这个地址。头同样是 `X-Daogang-Secret`。body 只收 `role: "user"`、`text`（最多 80 个码位）、`mode`、可选 `delivery_key`。这个键用来反查映射，不当成 `worker-*` 会话名。校验失败是 401。收下的一句交给外围 `dispatchLine`，不调用 `/api/chat`。历史全文、记忆、peer、preference、密钥和绝对路径不落盘。
