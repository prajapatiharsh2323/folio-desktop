# E5 runbook — code signing + updater end-to-end (Windows session)

**ID:** `P-20261116-02` · **Status:** pending execution (Windows-only)
**Source:** Production-readiness plan Phase 4 Step 4.4 (E5)

The updater wiring is authored and committed (`tauri-plugin-updater` +
`tauri-plugin-process`, `createUpdaterArtifacts: true`, user-initiated
"Check for updates" in Settings); what remains below needs a Windows host
and real signing keys.

## 1. Generate the signing keys

```powershell
cd desktop
pnpm tauri signer generate -w ~/.tauri/folio.key
# prints the public key; keep the private key + password safe, never commit
```

Replace `REPLACE_WITH_UPDATER_PUBLIC_KEY` in
`desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` with the
printed public key and commit that (it is public by design).

## 2. CI secrets

`.github/workflows/desktop-ci.yml` already passes
`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to
`pnpm tauri:build`; set them as repository secrets from step 1. With
`createUpdaterArtifacts: true` the build additionally produces
`*.sig` + `latest.json` update artifacts next to the NSIS installer —
upload those alongside the installer artifact (adjust the upload step's
`path` to include `bundle/nsis/*.sig` and `latest.json`).

## 3. Release flow

1. Tag (`v*`) → CI builds the signed installer + update artifacts.
2. Publish a GitHub release containing the installer, `*.sig`, and the
   generated `latest.json` (Tauri emits it when the updater artifacts are
   built; verify it points at the uploaded asset URLs).
3. The app's endpoint (`plugins.updater.endpoints`) already points at
   `releases/latest/download/latest.json`.

## 4. Verify end to end

1. Install the previous release build.
2. Publish a newer version; Settings → **Check for updates** → expect
   "Update available: x.y.z".
3. **Install and restart** → signature is verified, app relaunches on the
   new version (`Settings → About` shows the bumped version).
4. Tamper check: serve a modified `latest.json` from a local endpoint and
   confirm the check fails with a signature error (no install).

## 5. Installer signing (SmartScreen)

Authenticode-sign the NSIS installer (`signtool sign /fd SHA256 …` with an
OV/EV certificate or Azure Trusted Signing) as a post-build step, or add it
to the CI job after `tauri:build`. Record the certificate source and renewal
date in the release notes template.

## Known constraints

- No background update checks, ever: the only trigger is the Settings
  button (privacy posture, 05 §2).
- `withGlobalTauri` stays off (see `P-20261116-01`); the updater uses the
  JS guest plugin, which does not require it.
