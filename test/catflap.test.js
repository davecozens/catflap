import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxy } from '../lib/proxy.js';
import { slug } from '../lib/services.js';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const get = (port, host, path = '/', headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers: { host, ...headers } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  }).on('error', reject);
});

test('names become hostnames', () => {
  assert.equal(slug('Cat Herder!'), 'cat-herder');
  assert.equal(slug('Holly starbug'), 'holly-starbug');
});

test('routes by name, forwards the visitor, explains the rest', async () => {
  const upstream = http.createServer((req, res) => res.end(JSON.stringify({ path: req.url, xff: req.headers['x-forwarded-for'], host: req.headers['x-forwarded-host'] })));
  const upPort = await listen(upstream);
  const state = {
    config: { directoryName: 'home' }, other: [],
    services: [
      { name: 'app', title: 'App', port: upPort, lan: true, running: true },
      { name: 'down', title: 'Down', port: 1, lan: true, running: false },
    ],
  };
  const proxy = createProxy({ getState: () => state });
  const port = await listen(proxy);
  try {
    const r = await get(port, 'app.local', '/x?y=1');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.path, '/x?y=1');
    assert.equal(body.host, 'app.local');
    assert.equal(body.xff, '127.0.0.1');
    assert.equal((await get(port, 'down.local')).status, 503);
    assert.equal((await get(port, 'nope.local')).status, 404);
    const dir = await get(port, 'home.local', '/api/directory');
    assert.equal(JSON.parse(dir.body).services.length, 2);
  } finally { proxy.close(); upstream.close(); }
});
