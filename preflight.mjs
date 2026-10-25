/**
 * 预检：不需要真实 DSH，就能验证掉绝大部分失败面。
 *
 *   1. 模块能被 import，apply 不抛异常
 *   2. 能在 config.port 指定的端口监听
 *   3. 能把连接原样转发到一个假上游
 *   4. 换 config.port 真的换端口（证明端口没写死在代码里）
 *
 * 端口随机取，避免和真实环境撞车，也可以在 CI 上直接跑。
 */
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { apply, name } from './index.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = netServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const UPSTREAM = await freePort();
const PORT_A = await freePort();
const PORT_B = await freePort();

const upstream = httpServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, from: 'fake-dsh', seenPath: req.url }));
});
await new Promise((r) => upstream.listen(UPSTREAM, '127.0.0.1', r));

const stubCtx = {
  logger: {
    info: (m) => check('log.info', true, m),
    warn: (m) => check('log.warn', false, m),
    error: (m) => check('log.error', false, m),
    debug: () => {},
  },
  inject(deps, cb) {
    if (!deps.includes('webServer')) throw new Error('unexpected deps ' + deps);
    return cb({ webServer: { listenedPort: UPSTREAM, config: { port: UPSTREAM, host: '127.0.0.1' } } });
  },
};

const hit = async (port) => {
  const res = await fetch('http://127.0.0.1:' + port + '/healthz');
  return { status: res.status, body: await res.json() };
};

check('plugin name export', name === 'fixed-port-bridge', String(name));

apply(stubCtx, { port: PORT_A });
await wait(250);
try {
  const a = await hit(PORT_A);
  check('forwards via config.port', a.status === 200 && a.body.from === 'fake-dsh', JSON.stringify(a));
} catch (e) {
  check('forwards via config.port', false, String(e && e.message));
}

apply(stubCtx, { port: PORT_B });
await wait(250);
try {
  const b = await hit(PORT_B);
  check('a different config.port listens too', b.status === 200 && b.body.from === 'fake-dsh', JSON.stringify(b));
} catch (e) {
  check('a different config.port listens too', false, String(e && e.message));
}

try {
  const c = await hit(PORT_A);
  check('first listener still serves', c.status === 200, 'status ' + c.status);
} catch (e) {
  check('first listener still serves', false, String(e && e.message));
}

upstream.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
