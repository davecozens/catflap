// Publish extra ".local" names for this Mac (housecat.local, home.local, …) so any phone,
// tablet or computer at home can use them. macOS's mDNSResponder does the work: each
// `dns-sd -P` registration lasts as long as its process runs. Re-published if the Mac's
// address changes.

import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export function lanAddress() {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && /^(en|bridge)/.test(name)) return a.address;
  }
  return null;
}

export class Names {
  #procs = new Map();   // name → child process
  #ip = null;

  constructor({ port = 80, log = () => {} } = {}) { this.port = port; this.log = log; }

  // Make the published set exactly `names`, at the current address.
  sync(names) {
    const ip = lanAddress();
    if (!ip) { this.stopAll(); return; }
    if (ip !== this.#ip) { this.stopAll(); this.#ip = ip; }
    for (const [name, p] of this.#procs) if (!names.includes(name)) { p.kill(); this.#procs.delete(name); }
    for (const name of names) {
      if (this.#procs.has(name)) continue;
      // Registers an address record name.local → ip, plus an _http service people can browse.
      const p = spawn('dns-sd', ['-P', name, '_http._tcp', 'local', String(this.port), `${name}.local`, ip, 'path=/'], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.on('data', (d) => { if (/Name conflict|-65548/.test(d)) this.log(`${name}.local is already taken on the network`); });
      p.on('exit', () => { if (this.#procs.get(name) === p) this.#procs.delete(name); });
      this.#procs.set(name, p);
    }
  }

  get ip() { return this.#ip; }
  get names() { return [...this.#procs.keys()]; }

  stopAll() { for (const p of this.#procs.values()) p.kill(); this.#procs.clear(); }
}
