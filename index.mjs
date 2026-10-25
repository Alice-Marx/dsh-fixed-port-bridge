/**
 * dsh-fixed-port-bridge — 用一个稳定的本地端口顶在 DSH 那个随机端口前面。
 *
 * DSH 桌面端启动器写死 `--port 0`，所以它的 web 端口每次启动都变；而
 * Coopanion 桌宠存着一个手填的固定地址。本插件在 DSH 进程内监听
 * cordis.patch.yml 里配置的端口，把每个连接原样转发给宿主真实绑定到的端口。
 *
 * 端口只出现在一处：patch 行的 config.port。
 */
import { createServer, connect } from 'node:net';

export const name = 'fixed-port-bridge';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 19387;

function log(ctx, level, message) {
  try {
    const logger = ctx && ctx.logger;
    if (logger && typeof logger[level] === 'function') logger[level]('[fixed-port-bridge] ' + message);
  } catch {}
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
    const listenPort = Number(config && config.port !== undefined ? config.port : DEFAULT_PORT);
    if (!Number.isInteger(listenPort) || listenPort <= 0) {
      log(ctx, 'error', 'config.port 无效：' + String(config && config.port));
      return;
    }
    if (typeof (ctx && ctx.inject) !== 'function') {
      log(ctx, 'warn', '宿主没有 ctx.inject，网桥未启动');
      return;
    }

    ctx.inject(['webServer'], (scoped) => {
      let server = null;
      try {
        server = createServer((socket) => {
          socket.on('error', () => {});
          const target = upstreamPort(scoped && scoped.webServer);
          if (target === null) { log(ctx, 'warn', '拿不到宿主端口，丢弃该连接'); socket.destroy(); return; }
          if (target === listenPort) { log(ctx, 'warn', '目标端口就是本端口，丢弃以避免回环'); socket.destroy(); return; }
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

        server.on('error', (error) => {
          const code = error && error.code;
          if (code === 'EADDRINUSE') log(ctx, 'warn', '端口 ' + listenPort + ' 已被占用（可能是另一个网桥或中继），未接管');
          else log(ctx, 'error', '监听 ' + listenPort + ' 失败：' + (code || (error && error.message) || error));
        });

        server.listen(listenPort, HOST, () => {
          log(ctx, 'info', '已监听 ws://' + HOST + ':' + listenPort + ' -> 宿主 :' + (upstreamPort(scoped && scoped.webServer) || '?'));
        });
      } catch (error) {
        log(ctx, 'error', '启动失败：' + ((error && error.message) || error));
      }
      return () => { try { if (server) server.close(); } catch {} };
    });
  } catch (error) {
    log(ctx, 'error', 'apply 失败：' + ((error && error.message) || error));
  }
}
