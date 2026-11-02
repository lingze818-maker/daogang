# inbox Source

本包是到岗的收件 Source，也是可以挂进 DeepSeek Harness 的 Cordis 插件。CLI 仍用 `LocalInbox.receive`，不经过 Cordis：

- 任务腿分配一个 `worker-<ticketId>` 会话名
- 闲聊腿记到 `main`
- 同一个 Trigger id 再投一次得到 `duplicate`，不新开票

这不等于底座的 Assignment，也没有调用 `DshExecutor.start`。产品层的角色写在卡片上，实现层仍是一票一个会话名。派工在分发器的 `ExecutorPort`：默认 `LocalExecutor`。设置 `DAOGANG_DSH_ROOT` 时，适配器才按路径调用克隆里的 `start` / `deliver`。

## 对照上游食谱

不要把 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 整仓复制进来。Source 的写法以这篇为准：

[docs/008-cookbook.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/008-cookbook.md)

| 食谱 | 本包 | 状态 |
| --- | --- | --- |
| 译成 Trigger（稳定 id、Thread、actor、`addressed`） | `inboxTrigger` | CLI 每条输入 `addressed: direct`。本腿卡片在 `meta.cards`，同一段也写进 `text`（`[daogang-cards]`）。`triggerMessage` 只读 `text` |
| `scope`，未列入的对话仍交给 receive | `inboxKind.scope` → `inboxScope` | 只看 `meta.conversation`。真实 Engine 未挂 |
| Policy 的 explicit 与 admission `rows` | `inboxKind.policy`，Zod `schema` | 默认 `allowed: []`。`rows` 的形状在；名单还没有进底座已保存的 Policy |
| Channel：`send` 幂等，只有永久失败才 `gone` | 分发器里的 `main-stub` | 主窗是本地桩，不是底座 Channel.send |
| `threadContext` | — | 未做 |
| 插件 `name` / `inject` / `apply`，`effect` 里 register，循环里 `receive` | `apply` + `watchInbox` | `register` 的返回值当作卸载函数，和 `SourceRegistry.register` 一样 |
| `package.json` exports、`cordis.patch.yml` insert | `exports["."]` → `lib/index.js`、`cordis.patch.yml` | 默认 `disabled: true`。Node 不剥离 `node_modules` 里的 TypeScript，所以入口是构建产物 |

`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-*` 都不是本包的 dependency 或 peerDependency。唯一的依赖是 `zod@4.4.3`，和上游锁定的主版本一致，用来提供 `schema.parse` / `safeParse`。pnpm 会把可选 peer 写进锁文件并装上，所以这里不声明 cordis。执行口用 `DAOGANG_DSH_ROOT` 指到本机克隆；要让 Cordis 解析到本包，在 DSH profile 里用 `file:` 或 `link:`。

不能依赖的内部类见仓库 [底座结构笔记 §6](../../docs/notes/底座结构笔记-2026-11-01.md)。本包不 import `Engine`、`Store`、`DshExecutor`。

## 挂到本机 DSH 克隆

上游单独 clone，不要复制进本仓。下面的安装不需要 API key。`dsh` 的版本号来自上游 `docs/006-deployment.md` 里当时写明的公开 pin；`engines.dsh` 仍是 `^0.2.1-alpha.2`。

```bash
# 终端 A：上游自己的目录
git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git
cd dsh-superagent-prototype
pnpm install && pnpm build

# 还没有 superagent profile 时，按上游 Install 一节（会装公开的 dsh CLI，不需要模型 key）：
# npm install -g @deepseek-ai/dsh@0.2.1-rc.3
# dsh superagent --from-default-profile web --dump-config > /dev/null
# dsh plugin --profile superagent add "link:$PWD"

# 终端 B：本仓。把 inbox Source 装进同一个 profile。两条里走一条。
# link: 与上游给自己 bundle 的写法相同。file: 一样能被 Node 解析。
dsh plugin --profile superagent add "link:$PWD/packages/inbox-source"
# dsh plugin --profile superagent add "file:$PWD/packages/inbox-source"
```

改过 `src/` 之后先构建，再挂。仓库里已经有一份 `lib/`，没改源码就不用再构建：

```bash
pnpm build:inbox
```

`dsh plugin add` 读到 `package.json` 里的 `dsh.bundle.patch`，把本包加进 profile 的 bundle 列表。补丁 [cordis.patch.yml](./cordis.patch.yml) 插入 `id: daogang-inbox`，**默认 `disabled: true`**。Cordis 对 `disabled: true` 的条目不 import。

Node 拒绝剥离 `node_modules` 里的 `.ts`（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。`file:` 会进 pnpm 的 store，因此入口必须是 `lib/index.js`。`link:` 通常是指到仓库目录的符号链接，解析到的也是这份构建产物。

要打开，把 [examples/profile.cordis.patch.yml](./examples/profile.cordis.patch.yml) 里的两行合并进 profile 的 `cordis.patch.yml`（上游示例是 `~/.dsh/profiles/superagent/cordis.patch.yml`）。不要把本包补丁里的 `disabled` 改成 `false` 再交回上游。

没有 `dsh` CLI 时，可以先只检查包能否被解析。在一个空目录里：

```bash
pnpm add @daogang/inbox-source@file:<到岗仓>/packages/inbox-source
node --input-type=module -e "import('@daogang/inbox-source').then(m => console.log(m.name, typeof m.apply, typeof m.inboxKind.schema.safeParse))"
```

期望打出 `daogang-inbox function function`。

对照克隆里的注册表（不启动 DSH，不读密钥）：

```bash
# 在本仓。DAOGANG_DSH_ROOT 指向上游克隆，且该目录已经 pnpm install。
DAOGANG_DSH_ROOT=<上游克隆> node scripts/check-inbox-attach.mjs
```

没设这个变量时，脚本只检查本包的 export、补丁和 Zod，然后退出 0。`pnpm test` 不读它。

## 默认行为

- 插件名 `daogang-inbox`，`inject` 是 `orchestrator`。这个服务由上游 `Runtime` 提供，和 `github-watch` 一样。
- 配置 schema 默认 `{ conversation: 'cli' }`。只匹配这一条对话。多余的键或非法对话名让 `safeParse` 失败，`SourceRegistry` 会关掉该实例并回落到这份默认。
- 策略 schema 默认 `{ allowed: [] }`。没人被写成可以发起工作。
- `configured()` 为 false 时循环上报 `setupPending` 并且不 `receive`。底座的 `configured()` 要等 GitHub 仓库和智能体 CLI 通过 Setup；飞书可以空着。`SETUP_FIELDS` 里没有 `inbox`。

## 无密钥核对（2026-11-02）

上游是公开仓 `main` 的 `6337fc823ce20251c8de8085948165c81aaa701e`。克隆只留在检查机上，没有抄进本仓，也没有改它。没有 API key，没有调用 `gh` / `lark-cli`。

已经对上的：

- `pnpm add` 的 `file:` 和 `link:` 都能 `import('@daogang/inbox-source')`，得到 `daogang-inbox` 和 `schema.safeParse`。改成 `lib/index.js` 之前，`file:` 进 `node_modules` 会在加载 `.ts` 时被 Node 拒绝。
- 已发布的 `@deepseek-ai/cordis@4.0.5` 与 `@deepseek-ai/cordis-plugin-loader@1.0.6`：`disabled: true` 不加载模块；打开之后 `apply` 会 `register`。`safeParse({})` 成功，非法配置失败。宿主 `configured()` 为 false 时上报 `setupPending`，不 `receive`。这是临时 loader 加一个假的 `orchestrator`，不是 dsh-superagent 进程。
- 克隆里的 `SourceRegistry`：只有 `parse`、没有 `safeParse` 的 schema，`instances()` 抛 `safeParse is not a function`。本包的 Zod schema 可以被登记。存进去的非法配置会把实例关掉，并回落到 `{ conversation: 'cli' }`。`scope` 对其他对话给出 `conversation_not_listed`。`register` 的返回值能卸掉 kind。
- 克隆里的 `Setup.run`（空 settings）：返回 false，`configured()` 为 false，`problem.code` 是 `repositoryUnset`（位置 `github`）。空飞书 CLI 的 `resolveFeishuBot` 得到 `undefined`，不单独失败。`SETUP_FIELDS` 只有 `github` 的 `repository` / `cli` 和 `feishu` 的 `cli`，没有 `inbox`。自定义 Source 不加 Setup 字段，但没配 GitHub 仓库时整个 runtime 的 `configured()` 仍是 false。
- `dsh@0.2.1-rc.3`：用 web 模板建了一个临时 profile，没有装 dsh-superagent 本体，也没有启动进程。`dsh plugin --profile superagent add` 的 `file:` 和随后的 `link:` 都成功，本包进入 dependencies 和 `dsh.profile.bundles`。`dsh --profile superagent --dump-config` 退出 0，组合结果里有 `id: daogang-inbox`、`name: '@daogang/inbox-source'`、`disabled: true`。

`scripts/check-inbox-attach.mjs` 复跑的是 `SourceRegistry` 和 `Setup` 这一段。上游源码用了参数属性，脚本会自己加上 Node 的 `--experimental-transform-types`，不必先 `pnpm build` 上游。

## 假 orchestrator 与 effect 表

`cordis.patch.yml` 保持 `disabled: true`。要在 Cordis 里把插件打开，用克隆自带的 `Context.plugin`，不改补丁文件：

```bash
DAOGANG_DSH_ROOT=<上游克隆> node scripts/check-effects.mjs
```

没设变量时退出 0。克隆需已 `pnpm install`。脚本不读密钥，`pnpm test` 不跑它。

已经对上的（上游 `6337fc8`，无密钥）：

- 公开 `Store` + 未调用 `start()` 的 `Effects`，接上 `DshExecutor.start` / `deliver`。临时库 `effect` 表有 `launch` 和 `delivery`，`attempts` 为 0。`sessions.prompt` 没有被调用。
- 公开 enqueue 载荷仍只有 id。卡片在 Trigger `text` / `meta.cards`。`triggerMessage`、`ticketExecution`（explicit 的 note）和 `inputMessage` 之后，卡片摘要还在。这是私有 `launch()` 会交给 `sessions.prompt` 的那一层，这一步不调用 `launch()`。
- Cordis `Context.plugin` 注入假 `orchestrator`。`configured()` 为 false 时上报 `setupPending` 并且不 `receive`。为 true 时 `receive` 拿到带卡片的 Trigger。

## Runtime 与 stub launch

`check-effects.mjs` 不构造 Runtime，也不调用 `Effects.start()`。下一支脚本补这两段，仍然不读密钥，`pnpm test` 不跑：

```bash
# 退出 0 需要能解析 await using 的 Node。本轮是 v24.22.2。
DAOGANG_DSH_ROOT=<上游克隆> node scripts/check-runtime.mjs
```

没设变量时退出 0。v24.22.2 上：空 GitHub 配置的 `Runtime` 停在 `setupPending`，`effects.start()` 没有被调用；夹具让 `configured()` 为 true 之后，`effects.start()` 一次，主会话 `sessions.ensure` 一次（桩，没有 `sessionController`）；齐全的票夹具让 handler 进入私有 `launch()`，stub `sessions.prompt` 的 `assignment` 和 `trigger.text` 仍含 `[daogang-cards]`。v22.23.4 解析不了 `await using`，Runtime 与 configured 两段失败。细节在结构笔记 §10。

## 还没验证

没有启动 superagent 进程。Runtime 探测的 webServer 只登记、不监听。stub `sessions.ensure` / `prompt` 没有创建 DSH Session，也没有模型请求。`configured()===true` 已经用夹具走过，真实 `gh` 身份没有。Channel 和 `threadContext` 没做。假 orchestrator 不是装好的 dsh-superagent 进程。plugin-loader 读 `disabled: false` 的 profile 这一轮没有再跑；补丁文件仍是 `disabled: true`。
