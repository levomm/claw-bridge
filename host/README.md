# CLAW Host

CLAW Host is the Windows-side companion for CLAW Bridge. It runs in the signed-in
user session so browser and Windows UI operations can interact with the visible
desktop.

The server binds to `127.0.0.1:8790` by default. Use Tailscale or another private
encrypted network before binding it to a LAN address. Never expose this port to
the public internet.

```powershell
npm ci
$env:CLAW_HOST_ROOTS = "$HOME\Projects"
npm start
```

The first launch creates a random token at `%USERPROFILE%\.claw-host\token`.
Write, shell, app launch, browser, focus and screenshot operations also require
an approval flag supplied by the paired CLAW Bridge gateway.

Current methods:

- `host.status`
- `host.files.list`
- `host.files.read`
- `host.files.write`
- `host.shell.exec`
- `host.app.launch`
- `host.browser.open`
- `host.ui.windows`
- `host.ui.focus`
- `host.screenshot.capture`
