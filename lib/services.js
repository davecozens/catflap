// What runs on this Mac and what to call it. Three sources, later ones winning:
//   1. everything listening on a TCP port (lsof), so nothing is missed
//   2. tools Concierge knows about (~/.concierge/registry.json), for names and descriptions
//   3. catflap's own config (~/.catflap/config.json): names, and which ones the rest of
//      the house may reach ("lan": true)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
export const DIR = process.env.CATFLAP_HOME ?? path.join(os.homedir(), '.catflap');
const CONFIG = path.join(DIR, 'config.json');

// Starting point. "lan" is only true for apps that already face the network and check
// their own access token; everything else stays on this Mac until you say otherwise.
export const DEFAULT_CONFIG = {
  directoryName: 'home',
  services: {
    housecat: { port: 7350, title: 'housecat', description: 'What is on the home network, and the switches for it', lan: true },
    catherder: { port: 7345, title: 'Cat Herder', description: 'Keeps unattended AI agents on task', lan: true },
    kanbananas: { port: 5174, title: 'Kanbananas', description: 'Task board for AI agents', lan: false },
    proust: { port: 7331, title: 'Proust', description: 'Renders plans and PRs for review', lan: false },
    concierge: { port: 7333, title: 'Concierge', description: 'Catalogue and launcher for the local AI tools', lan: false },
    strata: { port: 7334, title: 'Strata', description: 'What is deployed, per environment (AWS)', lan: false },
    crux: { port: 7332, title: 'Crux', description: 'Decision log', lan: false },
    sophie: { port: 2872, title: 'Sophie', description: 'Mind maps with AI personas', lan: false },
    holly: { port: 7410, title: 'Holly starbug', description: 'This Mac\'s Holly worker', lan: false },
  },
};

export async function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG, 'utf8')) }; }
  catch {
    await mkdir(DIR, { recursive: true });
    await writeFile(CONFIG, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    return { ...DEFAULT_CONFIG };
  }
}

async function listening() {
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { timeout: 5000 });
    const out = new Map();
    for (const line of stdout.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      const m = f[8]?.match(/^(.*):(\d+)$/);
      if (!m) continue;
      const port = Number(m[2]);
      const e = out.get(port) ?? { port, process: f[0], pid: Number(f[1]), localOnly: true };
      // Bound to every interface, or to a LAN address, means the network can already reach it.
      if (!/^(127\.|\[::1\]|localhost)/.test(m[1])) e.localOnly = false;
      out.set(port, e);
    }
    return out;
  } catch { return new Map(); }
}

async function concierge() {
  try {
    const r = JSON.parse(await readFile(path.join(os.homedir(), '.concierge/registry.json'), 'utf8'));
    return Object.fromEntries((r.tools ?? []).filter((t) => t.port).map((t) => [t.id, { port: t.port, title: t.name, description: t.summary ?? null }]));
  } catch { return {}; }
}

const up = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port, timeout: 800 });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.on('connect', () => done(true)); s.on('timeout', () => done(false)); s.on('error', () => done(false));
});

// Names become hostnames: lower case, letters, digits and hyphens.
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function discover() {
  const [config, ports, known] = await Promise.all([loadConfig(), listening(), concierge()]);
  const services = {};
  for (const [id, s] of Object.entries(known)) services[slug(id)] = { ...s, lan: false };
  for (const [id, s] of Object.entries(config.services)) services[slug(id)] = { ...services[slug(id)], ...s };
  const named = new Set(Object.values(services).map((s) => s.port));
  const list = await Promise.all(Object.entries(services).map(async ([name, s]) => ({
    name, ...s, running: await up(s.port), process: ports.get(s.port)?.process ?? null, alreadyOnLan: ports.get(s.port)?.localOnly === false,
  })));
  // Anything else listening, so the directory is a complete answer to "what's on which port".
  const other = [...ports.values()].filter((p) => !named.has(p.port) && p.port !== 80 && p.port < 49152)
    .map((p) => ({ port: p.port, process: p.process, localOnly: p.localOnly }))
    .sort((a, b) => a.port - b.port);
  return { config, services: list.sort((a, b) => (b.running - a.running) || a.title.localeCompare(b.title)), other };
}
