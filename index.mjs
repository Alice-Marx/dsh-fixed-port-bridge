/**
 * dsh-fixed-port-bridge — 用一个稳定的本地端口顶在 DSH 那个随机端口前面。
 *
 * DSH 桌面端启动器写死 `--port 0`，所以它的 web 端口每次启动都变；而
 * Coopanion 桌宠存着一个手填的固定地址。本插件在 DSH 进程内监听固定端口，
 * 把每个连接原样转发给宿主真实绑定到的端口。
 *
 * 端口来源（先到先得）：<profileDir>/.dsh-fixed-port-bridge.json > config.port > 19387。
 * 界面通过 /coopanion/fixed-port-bridge/{state,port} 读写，改端口不用重启 DSH。
 */
import { createServer, connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'fixed-port-bridge';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 19387;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const STATE_ROUTE = '/coopanion/fixed-port-bridge/state';
const PORT_ROUTE = '/coopanion/fixed-port-bridge/port';
const STATE_FILE = '.dsh-fixed-port-bridge.json';
const MAX_BODY_BYTES = 4096;
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const PROFILE_ARG = /[\\/]profiles[\\/]([^\\/]+)[\\/]?$/;

/**
 * Config schema 只为让宿主内置插件页渲染出「端口」输入框 —— 表单和标签由宿主按 schema 生成，
 * 我们不用写任何界面。schemastery 在 profile 的 node_modules 里（刻意不写进 package.json
 * 依赖，免得被兼容性版本范围拦下）；在仓库目录这类解析不到它的环境里模块也必须照常
 * 加载成功，所以解析不到就不导出 Config。
 */
const requireFromPlugin = createRequire(import.meta.url);

function loadSchemastery() {
  for (const id of ['@deepseek-ai/schemastery', join(profileDir(), 'node_modules', '@deepseek-ai/schemastery')]) {
    try {
      const loaded = requireFromPlugin(id);
      const mod = loaded && loaded.default ? loaded.default : loaded;
      if (mod && typeof mod.object === 'function') return mod;
    } catch {}
  }
  return null;
}

let Config;
try {
  const z = loadSchemastery();
  Config = z
    ? z.object({
        port: z.number().min(MIN_PORT).max(MAX_PORT).step(1).default(DEFAULT_PORT).volatile(),
      })
    : undefined;
} catch {
  Config = undefined;
}
export { Config };

function log(ctx, level, message) {
  const line = '[fixed-port-bridge] ' + message;
  try {
    const logger = ctx && ctx.logger;
    if (logger && typeof logger[level] === 'function') {
      logger[level](line);
      return;
    }
  } catch {}
  // 宿主没给 logger 时也要留痕（warn/error 才刷屏，info 静默）
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
}

/** Config 里 .volatile() 的字段到 apply 时是带 get() 的包装对象；普通值原样返回。 */
function liveValue(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
}

/** 合法端口或 null（不抛异常，调用方只需判断 null）。 */
function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/**
 * profile 目录：主进程 argv 里通常带着 .../profiles/<name> 这个绝对路径；
 * 抓不到就退回 DSH_HOME（或 ~/.dsh）+ profiles/desktop。
 */
function profileDir() {
  for (const arg of process.argv) {
    if (typeof arg === 'string' && PROFILE_ARG.test(arg)) return arg.replace(/[\\/]+$/, '');
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'profiles', 'desktop');
}

/** 持久化端口；文件缺失、坏 JSON、端口非法一律当作没写过。 */
function savedPort(file) {
  try {
    return validPort(JSON.parse(readFileSync(file, 'utf8')).port);
  } catch {
    return null;
  }
}

/**
 * 宿主真实端口，惰性读取：apply 执行时服务器可能还没 listen，
 * 但等到有连接进来时它一定已经绑定了。
 */
function upstreamPort(webServer) {
  const listened = Number(webServer && webServer.listenedPort);
  if (Number.isInteger(listened) && listened > 0) return listened;
  try {
    const address = webServer && webServer.server && webServer.server.address && webServer.server.address();
    if (address && typeof address === 'object' && Number(address.port) > 0) return Number(address.port);
  } catch {}
  const configured = Number(webServer && webServer.config && webServer.config.port);
  return Number.isInteger(configured) && configured > 0 ? configured : null;
}

export function apply(ctx, config = {}) {
  try {
    const configuredPort = Number(liveValue(config && config.port));
    if (config && config.port !== undefined && validPort(configuredPort) === null) {
      log(ctx, 'warn', 'config.port 无效（' + String(config.port) + '），退回 ' + DEFAULT_PORT);
    }
    const configPort = validPort(configuredPort) || DEFAULT_PORT;

    if (typeof (ctx && ctx.inject) !== 'function') {
      log(ctx, 'warn', '宿主没有 ctx.inject，网桥未启动');
      return;
    }

    // profile 目录定位不到真实目录时一律不落盘（只读 config.port）
    const dir = profileDir();
    const canPersist = existsSync(dir);
    const configPath = join(dir, STATE_FILE);
    const saved = canPersist ? savedPort(configPath) : null;

    let port = saved === null ? configPort : saved;
    let source = saved === null ? 'config' : 'file';

    ctx.inject(['webServer'], (scopedHost) => {
      const scoped = scopedHost || {};
      const webServer = scoped.webServer || null;
      let server = null; // 当前正在 accept 的 TCP server
      let boundPort = null; // 真正 listen 成功的端口（未监听时为 null）
      let disposed = false;
      const routeDisposers = [];

      /** 建一个把连接原样转发给宿主真实端口的 server；listenPort 只用于回环自检。 */
      const createBridge = (listenPort) =>
        createServer((socket) => {
          socket.on('error', () => {});
          const target = upstreamPort(webServer);
          if (target === null) {
            log(ctx, 'warn', '拿不到宿主端口，丢弃该连接');
            socket.destroy();
            return;
          }
          if (target === listenPort) {
            log(ctx, 'warn', '目标端口就是本端口，丢弃以避免回环');
            socket.destroy();
            return;
          }
          const upstream = connect({ host: HOST, port: target });
          upstream.on('error', (error) => {
            log(ctx, 'warn', '上游 :' + target + ' 失败：' + ((error && (error.code || error.message)) || error));
            socket.destroy();
          });
          socket.on('close', () => upstream.destroy());
          upstream.on('close', () => socket.destroy());
          socket.pipe(upstream);
          upstream.pipe(socket);
        });

      /** listen 成功后才 resolve；失败时把半成品 server 关掉再 reject。 */
      const listenOn = (listenPort) =>
        new Promise((resolve, reject) => {
          const candidate = createBridge(listenPort);
          const fail = (error) => {
            candidate.removeListener('listening', ready);
            try {
              candidate.close();
            } catch {}
            reject(error);
          };
          const ready = () => {
            candidate.removeListener('error', fail);
            candidate.on('error', (error) => {
              log(ctx, 'warn', '监听 ' + listenPort + ' 出错：' + ((error && (error.code || error.message)) || error));
            });
            resolve(candidate);
          };
          candidate.once('error', fail);
          candidate.once('listening', ready);
          candidate.listen(listenPort, HOST);
        });

      const reportBindError = (listenPort, error) => {
        const code = error && error.code;
        if (code === 'EADDRINUSE') log(ctx, 'warn', '端口 ' + listenPort + ' 已被占用（可能是另一个网桥或中继），未接管');
        else log(ctx, 'error', '监听 ' + listenPort + ' 失败：' + (code || (error && error.message) || error));
      };

      /** 原子写端口，先 .tmp 再 rename。 */
      const persist = async (nextPort) => {
        if (!canPersist) throw new Error('profile 目录不存在：' + dir);
        const body = JSON.stringify({ port: nextPort, updatedAt: new Date().toISOString() });
        const tmp = configPath + '.tmp';
        await writeFile(tmp, body, 'utf8');
        await rename(tmp, configPath);
      };

      const sendJson = (res, status, body) => {
        try {
          const payload = JSON.stringify(body);
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(payload),
            'cache-control': 'no-store',
          });
          res.end(payload);
        } catch (error) {
          log(ctx, 'warn', '回包失败：' + ((error && error.message) || error));
          try {
            res.destroy();
          } catch {}
        }
      };

      /** Host 头必须是本机地址，挡掉浏览器跨站/劫持请求。 */
      const localOnly = (req, res) => {
        const header = req && req.headers && req.headers.host;
        if (typeof header === 'string' && LOCAL_HOST.test(header.trim())) return true;
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return false;
      };

      /** 读请求体，超过 4KB 直接拒（不再累积字节）。 */
      const readBody = (req) =>
        new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          let done = false;
          req.on('data', (chunk) => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              done = true;
              reject(new Error('请求体超过 ' + MAX_BODY_BYTES + ' 字节'));
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', () => {
            if (done) return;
            done = true;
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          req.on('error', (error) => {
            if (done) return;
            done = true;
            reject(error);
          });
        });

      const handleState = (req, res) => {
        if (!localOnly(req, res)) return;
        sendJson(res, 200, {
          ok: true,
          port: boundPort === null ? port : boundPort,
          source,
          listening: boundPort !== null,
          hostPort: upstreamPort(webServer),
          canPersist,
          configPath,
        });
      };

      const handlePortChange = async (req, res) => {
        if (!localOnly(req, res)) return;
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '只接受 POST' });
          return;
        }

        let text;
        try {
          text = await readBody(req);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: 'bad-json', message: (error && error.message) || '读取请求体失败' });
          return;
        }

        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          sendJson(res, 400, { ok: false, error: 'bad-json', message: '请求体不是合法 JSON' });
          return;
        }

        const nextPort = validPort(payload && payload.port);
        if (nextPort === null) {
          sendJson(res, 400, {
            ok: false,
            error: 'invalid-port',
            message: 'port 必须是 ' + MIN_PORT + '-' + MAX_PORT + ' 之间的整数',
          });
          return;
        }

        const previousPort = boundPort === null ? port : boundPort;
        if (boundPort !== null && nextPort === boundPort) {
          sendJson(res, 409, { ok: false, error: 'unchanged', port: boundPort });
          return;
        }

        // 关键顺序：新端口 listen 成功之后才关旧 server；失败则旧链路完全不动
        try {
          const candidate = await listenOn(nextPort);
          const previous = server;
          server = candidate;
          boundPort = nextPort;
          port = nextPort;
          try {
            if (previous) previous.close();
          } catch {}
        } catch (error) {
          const code = (error && error.code) || (error && error.message) || 'unknown';
          log(ctx, 'warn', '切换到端口 ' + nextPort + ' 失败：' + code);
          sendJson(res, 400, {
            ok: false,
            error: 'port-in-use',
            message: '端口 ' + nextPort + ' 绑不上（' + code + '），旧端口 ' + previousPort + ' 仍在监听',
          });
          return;
        }

        log(ctx, 'info', '端口已从 ' + previousPort + ' 切到 ' + nextPort);

        try {
          await persist(nextPort);
          source = 'file';
        } catch (error) {
          log(ctx, 'warn', '持久化失败：' + ((error && error.message) || error));
          sendJson(res, 400, {
            ok: false,
            error: 'persist-failed',
            message: '端口已切到 ' + nextPort + '，但写入 ' + configPath + ' 失败，重启后会回退',
          });
          return;
        }

        sendJson(res, 200, { ok: true, port: nextPort, previousPort });
      };

      /** 挂一个 exact 路由，返回它的 disposer（挂不上返回 null，绝不抛）。 */
      const mount = (routePath, handler) => {
        if (!webServer || typeof webServer.register !== 'function') return null;
        const route = { kind: 'exact', path: routePath, handler };
        try {
          let remove = null;
          const factory = () => {
            remove = webServer.register(route);
            return remove;
          };
          if (typeof scoped.effect === 'function') scoped.effect(factory, 'fixed-port-bridge:' + routePath);
          else factory();
          return typeof remove === 'function' ? remove : null;
        } catch (error) {
          log(ctx, 'warn', '挂载 ' + routePath + ' 失败：' + ((error && error.message) || error));
          return null;
        }
      };

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const remove of routeDisposers) {
          try {
            remove();
          } catch {}
        }
        routeDisposers.length = 0;
        const current = server;
        server = null;
        boundPort = null;
        try {
          if (current) current.close();
        } catch {}
      };

      // cordis 不保证 inject 的返回值被当作 disposer，所以同时挂进 effect 作用域；
      // 两条路径都走同一个 dispose，disposed 标志保证只执行一次。
      try {
        if (typeof scoped.effect === 'function') scoped.effect(() => dispose, 'fixed-port-bridge: dispose');
      } catch (error) {
        log(ctx, 'warn', '注册 dispose 失败：' + ((error && error.message) || error));
      }

      try {
        const stateRemove = mount(STATE_ROUTE, handleState);
        if (stateRemove) routeDisposers.push(stateRemove);
        const portRemove = mount(PORT_ROUTE, (req, res) => {
          handlePortChange(req, res).catch((error) => {
            log(ctx, 'warn', '处理端口请求失败：' + ((error && error.message) || error));
            sendJson(res, 400, { ok: false, error: 'bad-json', message: '内部错误' });
          });
        });
        if (portRemove) routeDisposers.push(portRemove);
      } catch (error) {
        log(ctx, 'warn', '注册路由失败：' + ((error && error.message) || error));
      }

      listenOn(port)
        .then((candidate) => {
          if (disposed) {
            try {
              candidate.close();
            } catch {}
            return;
          }
          server = candidate;
          boundPort = port;
          log(
            ctx,
            'info',
            '已监听 ws://' + HOST + ':' + port + ' -> 宿主 :' + (upstreamPort(webServer) || '?') + '（来源 ' + source + '）',
          );
        })
        .catch((error) => {
          if (disposed) return;
          reportBindError(port, error);
        });

      return dispose;
    });
  } catch (error) {
    log(ctx, 'error', 'apply 失败：' + ((error && error.message) || error));
  }
}
