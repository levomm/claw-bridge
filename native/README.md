# CLAW Bridge native runtime

This directory contains the Android-native runtime used by CLAW Bridge. It is
being integrated on the `mobile-harness-integration` branch and is intentionally
installable beside the current Capacitor beta while migration work is in
progress.

## Current state

- Android 9+ on ARM64
- private Ubuntu 20.04 PRoot environment
- foreground setup and execution services
- Android Keystore-backed provider credentials
- Node.js, Git and Claude Code in the core runtime
- optional Python, Android, C/C++ and PHP toolchains
- on-device project builds and APK installation

The preview application id is `ee.clawbridge.app.nativebeta`. The production
migration will switch to `ee.clawbridge.app` only after signed upgrade testing
has passed.

## Build

```bash
git submodule update --init --recursive
cd native
./gradlew testOnlineDebugUnitTest assembleOnlineDebug
```

The debug APK is written to:

```text
native/app/build/outputs/apk/online/debug/app-online-debug.apk
```

## Upstream

The initial native runtime is derived from
[`techjarves/Mobile-Harness`](https://github.com/techjarves/Mobile-Harness) at
commit `c02b663`. The original documentation remains available in the
[upstream repository](https://github.com/techjarves/Mobile-Harness/tree/c02b663),
and its MIT license is preserved in [`LICENSE`](LICENSE). Bundled third-party
components retain their own licenses under `app/src/main/assets/licenses/`.

The runtime bundles are temporarily downloaded from the upstream release with
published SHA-256 verification. They will be mirrored to CLAW Bridge releases
before the production migration.
