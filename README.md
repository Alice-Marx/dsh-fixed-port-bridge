# @ljwei-stak/dsh-fixed-port-bridge

给 DeepSeek Harness（DSH）一个**固定的本地端口**。

DSH 桌面端的启动器把 `--port 0` 写死在代码里，所以它的 web 端口每次启动都由操作系统随机分配（实测同一台机器上依次是 59507 → 65361 → 54266 → 58834）。任何"记住 DSH 端口"的客户端——桌宠、IDE 插件、浏览器书签、反向代理——每次重启都要改一遍。

这个插件在 **DSH 进程内**监听一个你在配置里指定的端口，把连接原样转发给宿主当次真实绑定的端口。客户端从此只认一个地址。

## 原理

```
你的客户端 ──固定端口──► 本插件（跑在 DSH 进程里）──► DSH 真实端口（随机）
```

- 通过 `ctx.inject(['webServer'])` 拿到宿主服务，惰性读取它真实绑定的 `listenedPort`
- `net.createServer` 在 `config.port` 上监听，每个连接用 `socket.pipe` 原样转发
- 因为生命周期跟着 DSH 走，**DSH 起来它就在**，不需要独立守护进程、不需要开机自启、不需要扫描端口

## 安装

### 1. 插件市场（桌面端推荐）

在 DSH 的**插件市场**里，来源填本仓库地址：

```
https://github.com/Alice-Marx/dsh-fixed-port-bridge
```

### 2. npm（web profile）

```
dsh plugin add @ljwei-stak/dsh-fixed-port-bridge
```

> 桌面端的 `desktop` profile 由 Electron 应用独占管理，`dsh plugin` 命令行按设计拒绝修改它，所以桌面端请走插件市场。

### 3. 手工放置

把包目录放进 `<profile>/node_modules/@ljwei-stak/dsh-fixed-port-bridge`，并在该 profile 的 `package.json` 里把包名追加进 `dsh.profile.bundles`，然后重启 DSH。

## 配置

### 装好之后：在 DSH 设置里直接改（不用重启）

装好并重启一次 DSH 之后，**设置里会多出「固定端口」板块**（`settings.section`）。在里面填端口、保存即可 —— 端口当场热切到新值，**不用重启 DSH**，桌宠/脚本那边同步改成新端口就行。

端口取值优先级（先到先得）：

1. `<profileDir>/.dsh-fixed-port-bridge.json` —— 在设置面板里保存端口时写下的那份
2. 插件自带 `cordis.patch.yml` 里的 `config.port`
3. 内置默认 `19387`

> **一旦落过盘，再改 yml 就不生效。** 只要第 1 项存在，它就一直盖住 `config.port`。想交回 yml 控制：删掉 `<profileDir>/.dsh-fixed-port-bridge.json` 再重启 DSH。改 yml 的人要知道这一条，否则会遇到"改了配置没反应"。

### 首次安装：yml 里的默认值

`cordis.patch.yml` 依旧是首次安装时的端口来源（还没落过盘时，它就是唯一生效的配置）：

```yaml
- insert:
    - id: fixed-port-bridge
      name: "@ljwei-stak/dsh-fixed-port-bridge"
      required: false
      config:
        port: 19387      # ← 首次安装的默认值
```

改这一处需要重启 DSH。**记得同时把客户端里的地址改成新端口** —— 端口的两半分别在这两处。

### 设置面板背后的两个端点

浏览器半不读也不写 yml，它只调宿主半挂在 web 面上的两个 exact 路由（同源，走 DSH 当次真实端口或固定端口都行）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/coopanion/fixed-port-bridge/state` | 读状态：`{ ok, port, source, listening, hostPort, canPersist, configPath }` |
| `POST` | `/coopanion/fixed-port-bridge/port` | 热切端口并落盘，body 为 `{ "port": 19387 }`，成功回 `{ ok: true, port, previousPort }` |

`source` 取值：`file`（来自状态文件）或 `config`（来自 `config.port`，尚未落过盘）。

错误码：

| HTTP | `error` | 含义 |
| --- | --- | --- |
| 403 | `forbidden` | `Host` 头不是 `127.0.0.1` / `localhost`，挡跨站请求 |
| 405 | `method-not-allowed` | 对 `/port` 用了非 POST |
| 400 | `bad-json` | 请求体不是合法 JSON；**body 超过 4KB 也落这个码**（超限即拒，不会回 413） |
| 400 | `invalid-port` | `port` 不是 1024–65535 之间的整数 |
| 409 | `unchanged` | 新端口和当前正在监听的一致，什么都没做 |
| 400 | `port-in-use` | 新端口绑不上，**旧端口继续监听**（先 listen 成功才关旧链路） |
| 400 | `persist-failed` | 端口已经切过去了，但写状态文件失败 —— 重启后会回退 |

注意这两个端点挂在宿主真实的 web 面上，所以固定端口上暴露的仍然是**整个** web 面（含 GUI），见「已知边界」第 1 条 —— 本插件只做整端口 TCP 直通，不做路径过滤。

## 验证

```bash
# 端口有人监听，且返回 DSH 的状态
curl -s http://127.0.0.1:19387/<your-client-path>

# 确认是本插件在监听：这个 PID 应该等于 DSH 主进程的 PID
netstat -ano | findstr :19387
tasklist | findstr "DeepSeek Harness"
```

如果固定端口的监听 PID 是一个独立的 `node.exe`，说明占着端口的是别的进程（例如你自己搭的中继），本插件会因为 `EADDRINUSE` 记一条 warn 然后让位——宿主不会受影响。

## 自测

```bash
npm test
```

`preflight.mjs` 会用一个桩宿主启动插件、伪造一个上游服务，验证"能导入 / 能监听 / 能转发 / 换 `config.port` 真的换端口"。它不触碰真实的 DSH。

## 兼容性

- **不声明** `engines.dsh`，也**不声明** `@deepseek-ai/*` peer 依赖 —— 这样 DSH 的 `evaluatePluginCompatibility` 不会因版本范围把你拦在门外。
- 行上带 `required: false`：插件运行时抛错时宿主跳过它，而不是让整个 DSH 起不来。
- `apply` 全程 try/catch，任何异常只记日志。
- 浏览器半只用 `"dsh": { "client": { "platform": "web" } }` 声明装载，**故意不写 `client.inject`**。`inject` 的含义是"必须先把这些客户端包注入进来"，缺任何一个整个板块就挂起不出现；而本机的 `@deepseek-ai/dsh-client-ui-slots` 是个指向已失效目标的 junction，硬声明它等于自己制造装不上的情况。客户端代码里对两个服务都做了可选探测：有 `ctx.slots` 才注册板块，没有就 warn 后跳过；`locale` 缺失就回落到内置中文。

## 已知边界

1. **只做 TCP 转发，不做路径过滤**：固定端口上暴露的是整个 DSH web 面（含 GUI），不限于某一条路径。默认只绑 `127.0.0.1`，不对外网开放。
2. **依赖宿主的 `webServer` 服务**（`listenedPort` / `server.address()` / `config.port` 三选一取值）。DSH 大版本若改变这个服务的形状，插件会失效，症状是固定端口无人监听。
3. **端口被占用时不抢占**：记一条 warn 后让位，宿主照常运行。

## License

MIT
