# catflap

One front door for everything running on this Mac. Instead of remembering ports, any phone, tablet or computer at home can use names:

- **http://home.local**: a directory of every service, with live up/down status
- **http://housecat.local**, **http://catherder.local** and so on: each service by name

## How it works

- **Names.** Each service gets a `.local` name published with macOS's own Bonjour (`dns-sd -P`), the same mechanism behind `Daves-MacBook-Pro.local`. No router or DNS changes. iPhones, iPads and Macs resolve them natively. If the Mac's address changes, they are re-published.
- **Ports.** A small proxy on port 80 forwards each name to its port. Server-sent events and WebSockets pass through.
- **Discovery.** Services come from catflap's config, Concierge's registry and whatever is listening (`lsof`). Ports nobody has named show in the directory too, but only when you view it on the Mac.

## Who can reach what

`~/.catflap/config.json` lists each service with `"lan": true` or `false`.

- **`lan: false`** (the default for the AI tools: Crux, Concierge, Strata, Proust, Kanbananas…): the name works on the Mac. Other devices get a page saying it only works on the Mac. Several of these deliberately listen only on localhost, and Strata holds AWS details.
- **`lan: true`**: housecat and Cat Herder, which check their own access token. The visitor's real address is passed in `X-Forwarded-For`, and both apps treat a forwarded visitor as remote, so the token is still required.

Only set `lan: true` for something that has its own sign-in.

## Run it

```bash
node bin/catflap.js list               # what it publishes and what is running
node bin/catflap.js serve              # run in the foreground
node bin/catflap.js service install    # start at login, restart if it stops (launchd)
node bin/catflap.js service status
```

Edit `~/.catflap/config.json` to add or rename services. catflap picks up changes within 20 seconds.

## Limits

- It runs on a MacBook: when the Mac is asleep or away, the names stop working.
- `.local` names need mDNS. Apple devices and Windows 10+ handle it; some Android browsers do not.
- Port 80 only (no HTTPS). That is fine on a home network; tokens travel in the clear on your Wi-Fi.
