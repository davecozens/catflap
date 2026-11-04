#!/usr/bin/env node
// catflap — one front door for everything running on this Mac.
//
//   catflap serve                  names on the network + proxy on port 80 + directory
//   catflap list                   what it would publish, and what is running
//   catflap service install        start at login and keep running (launchd)
//   catflap service uninstall | status
//
// Then, from any device at home: http://home.local for the directory, and
// http://<name>.local for each service (e.g. http://housecat.local).

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { discover, DIR } from '../lib/services.js';

const run = promisify(execFile);
const SELF = fileURLToPath(import.meta.url);
const [cmd, sub] = process.argv.slice(2);
const LABEL = 'com.catflap.service';
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const help = async () => console.log((await readFile(SELF, 'utf8')).split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));

switch (cmd) {
  case 'serve': {
    const { createProxy } = await import('../lib/proxy.js');
    const { Names } = await import('../lib/mdns.js');
    const log = (m) => console.error(`[catflap ${new Date().toISOString().slice(11, 19)}] ${m}`);
    let state = await discover();
    const names = new Names({ port: 80, log });
    const publish = () => names.sync([state.config.directoryName, ...state.services.map((s) => s.name)]);
    const server = createProxy({ getState: () => state, log });
    server.listen(80, '0.0.0.0', () => {
      publish();
      log(`directory: http://${state.config.directoryName}.local/  (${names.ip})`);
      log(`names: ${state.services.map((s) => `${s.name}.local${s.lan ? '' : ' (Mac only)'}`).join(', ')}`);
    });
    server.on('error', (e) => { log(`cannot listen on port 80: ${e.message}`); process.exit(1); });
    // Pick up new services, status changes and a new Wi-Fi address.
    setInterval(async () => { try { state = await discover(); publish(); } catch (e) { log(`refresh failed: ${e.message}`); } }, 20_000);
    process.on('uncaughtException', (e) => log(`unexpected error (kept running): ${e.stack ?? e.message}`));
    const stop = () => { names.stopAll(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    break;
  }

  case 'list': {
    const { services, other } = await discover();
    for (const s of services) console.log(`${(s.running ? '●' : '○')} ${`${s.name}.local`.padEnd(22)} → :${String(s.port).padEnd(6)} ${s.lan ? 'whole house' : 'this Mac only'}  ${s.title}`);
    if (other.length) console.log(`\nAlso listening: ${other.map((o) => `${o.port} (${o.process})`).join(', ')}`);
    break;
  }

  case 'service': {
    if (sub === 'install') {
      await mkdir(path.dirname(PLIST), { recursive: true });
      await mkdir(DIR, { recursive: true });
      await writeFile(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${SELF}</string><string>serve</string></array>
  <key>WorkingDirectory</key><string>${path.dirname(path.dirname(SELF))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(DIR, 'server.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(DIR, 'server.log')}</string>
</dict>
</plist>
`);
      await run('launchctl', ['bootout', `gui/${process.getuid()}`, PLIST]).catch(() => {});
      await run('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST]);
      console.log(`Installed and started; runs at login. Log: ${path.join(DIR, 'server.log')}`);
      break;
    }
    if (sub === 'uninstall') {
      await run('launchctl', ['bootout', `gui/${process.getuid()}`, PLIST]).catch(() => {});
      await unlink(PLIST).catch(() => {});
      console.log('Stopped and removed.');
      break;
    }
    if (sub === 'status') {
      try {
        const { stdout } = await run('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]);
        console.log(stdout.split('\n').filter((l) => /state =|pid =|last exit/.test(l)).map((l) => l.trim()).join('\n'));
      } catch { console.log('Not installed.'); }
      break;
    }
    await help();
    break;
  }

  default:
    await help();
}
