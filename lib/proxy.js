// Port 80: route each request by the name it was sent to. "housecat.local" goes to
// housecat's port; the directory name (home.local), this Mac's own name and its bare
// address show the directory. Streams (SSE) and WebSocket upgrades pass straight through.
//
// From other devices, only services marked "lan" are forwarded. Everything else answers
// with a page saying it only works on this Mac. The real client address travels in
// X-Forwarded-For, so apps that check their own tokens still treat LAN visitors as remote.

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

// Requests from this Mac (loopback or any of its own addresses) may reach everything.
function isThisMac(addr) {
  const a = (addr ?? '').replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  return Object.values(os.networkInterfaces()).flat().some((i) => i?.address === a);
}

const hostName = (req) => (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');

export function createProxy({ getState, log = () => {} }) {
  const route = (req) => {
    const { services, config } = getState();
    const name = hostName(req);
    const macName = os.hostname().toLowerCase().replace(/\.local$/, '');
    if (!name || name === config.directoryName || name === 'catflap' || name === macName || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return { directory: true };
    const s = services.find((x) => x.name === name);
    if (!s) return { unknown: name };
    if (!s.lan && !isThisMac(req.socket.remoteAddress)) return { blocked: s };
    if (!s.running) return { down: s };
    return { target: s };
  };

  const forwardHeaders = (req) => {
    const client = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    return {
      ...req.headers,
      'x-forwarded-for': req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${client}` : client,
      'x-forwarded-host': req.headers.host ?? '',
      'x-forwarded-proto': 'http',
    };
  };

  const server = http.createServer(async (req, res) => {
    const r = route(req);
    if (r.directory) {
      if (req.url === '/api/directory') {
        const { services, other, config } = getState();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
        const fromMac = isThisMac(req.socket.remoteAddress);
        return res.end(JSON.stringify({
          name: config.directoryName, fromMac,
          services: services.map(({ name, title, description, port, lan, running }) => ({ name, title, description, port, lan, running, url: `http://${name}.local/` })),
          // Other listening ports only for the Mac itself: no need to advertise the rest to the house.
          other: fromMac ? other : [],
        }));
      }
      const file = req.url === '/' ? 'index.html' : path.basename(req.url.split('?')[0]);
      try {
        const body = await readFile(path.join(PUBLIC, file));
        res.writeHead(200, { 'content-type': file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        return res.end(body);
      } catch { res.writeHead(404); return res.end('not found'); }
    }
    if (!r.target) return page(res, r);

    const up = http.request({ host: '127.0.0.1', port: r.target.port, method: req.method, path: req.url, headers: forwardHeaders(req) }, (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) page(res, { down: r.target }); else res.end(); log(`${r.target.name}: ${e.message}`); });
    req.pipe(up);
  });

  // WebSockets: hand the raw sockets to each other once the upstream accepts the upgrade.
  server.on('upgrade', (req, socket, head) => {
    const r = route(req);
    if (!r.target) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const up = net.connect(r.target.port, '127.0.0.1', () => {
      const headers = forwardHeaders(req);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });

  return server;
}

function page(res, r) {
  const [status, title, body] = r.blocked
    ? [403, `${r.blocked.title} only works on the Mac`, `${r.blocked.title} is set to stay on this Mac. To use it from other devices, set "lan": true for "${r.blocked.name}" in ~/.catflap/config.json, but only if it has its own sign-in.`]
    : r.down ? [503, `${r.down.title} isn't running`, `Nothing is answering on port ${r.down.port} right now. Start it on the Mac and refresh.`]
    : [404, `Nothing called ${r.unknown}.local`, 'catflap does not know that name.'];
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 16px;color:#1c1f1d;background:#f6f4ef">
<h1 style="font-size:22px">${title}</h1><p>${body}</p><p><a href="http://home.local/">All services</a></p></body>`);
}
