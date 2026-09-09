# CLAW Host

CLAW Host is the Windows-side companion for CLAW Bridge. It runs in the signed-in
user session so browser and Windows UI operations can interact with the visible
desktop.

The server binds to `127.0.0.1:8790` by default. Use Tailscale or another private
encrypted network before binding it to a LAN address. Never expose this port to
the public internet.

## Packaged Windows install

Download the `claw-host-windows` artifact from the Windows CLAW Host GitHub
Actions run, extract it, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1
```

The packaged installer includes its own Node executable. It requires Tailscale
to already be installed and signed in, binds only to the computer's Tailscale
IPv4 address, registers an auto-start entry for the current Windows user, and
prints the URL and pairing token to enter in the phone app. It does not install
RustDesk or expose a public port. The default accessible workspace is the
current user's Documents folder; pass `-WorkspaceRoot C:\path\to\work` to choose
a different existing folder.

The host deliberately runs in the signed-in desktop session, not as a Windows
service, because visible-app and screenshot operations cannot work from Windows
Session 0.

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
- `host.ui.elements`
- `host.ui.invoke`
- `host.ui.setValue`
- `host.ui.click`
- `host.ui.sendKeys`
- `host.screenshot.capture`
