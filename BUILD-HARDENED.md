# Build the hardened app on an Apple Silicon Mac

This build is for an Apple Silicon Mac running **macOS 14 or later**. macOS 14 is required for separate ChatGPT, Grok, and Gemini login stores. On macOS 13 the app shows **macOS 14+ required** and does not open the provider panes, so it does not fall back to one shared login store.

The commands below were checked for syntax against this repository. The DMG itself has to be produced on the Mac. Linux cannot compile or run the WKWebView build.

## Toolchain

Install these, then record the versions you actually used (`node -v`, `pnpm -v`, `rustc -vV`).

| Tool | Version to use |
|---|---|
| macOS | 14 or later. The login split uses `WKWebsiteDataStore dataStoreForIdentifier`, which is macOS 14+. |
| Xcode Command Line Tools | Current tools for your macOS. `xcode-select --install` if `clang` is missing. A full Xcode install is not required. |
| Node.js | 24, or any release matching `^22.13.0 \|\| >=24.0.0` from `package.json`. The upstream v1.9.6 macOS release job used Node 24. The Linux check of this fork used Node v22.23.4. |
| pnpm | **11.0.0**, the version in `packageManager`. Enable it with `corepack enable && corepack prepare pnpm@11.0.0 --activate`. |
| Rust | **1.85 or newer** (`rust-version` in `src-tauri/Cargo.toml`). A dependency needs Cargo's edition 2024, so 1.83 and older will not compile. The Linux test run of this fork used **rustc 1.99.1**. The upstream v1.9.6 release log used 1.98.1. Install with `rustup update stable` and use the Apple Silicon host (`aarch64-apple-darwin`). |

```bash
xcode-select --install
node -v
corepack enable
corepack prepare pnpm@11.0.0 --activate
pnpm -v
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
rustup target add aarch64-apple-darwin
rustc -vV
```

## Commit and lockfiles

Build one commit, from a clean tree. `pnpm-lock.yaml` and `src-tauri/Cargo.lock` are required. Do not refresh either lockfile, and do not run install or Cargo without the frozen and locked flags below.

```bash
git status --porcelain
git rev-parse HEAD
```

`git status --porcelain` must print nothing. The commit to build is the full SHA from `git rev-parse HEAD`. That SHA is also the first line of `scripts/record-build-fingerprint.sh`. The pull request checklist names the same SHA. Do not build any other commit.

## Commands

From the repository root, on that commit:

```bash
pnpm install --frozen-lockfile
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg -- --locked
sh scripts/record-build-fingerprint.sh
```

`pnpm verify` typechecks, lints, runs the frontend tests, checks the bundled adapters, builds the frontend, and fails if that build or the Rust sources reference `raw.githubusercontent.com`, `api.github.com`, or any other host that is not one of the three providers, their login hosts, or Tauri's local IPC hosts.

`--frozen-lockfile` stops pnpm from changing `pnpm-lock.yaml`. `--locked` stops Cargo from changing `Cargo.lock` during the test and the app build.

`scripts/record-build-fingerprint.sh` prints the commit, the SHA-256 of `pnpm-lock.yaml` and `src-tauri/Cargo.lock`, the SHA-256 of the ARM64 app binary and `.dmg` when those files exist, and the `codesign` display plus `codesign --verify --deep --strict` when `codesign` exists. Keep that output with the disk image. A dirty tree makes the script exit without printing a fingerprint.

The first Rust release build compiles the Tauri crates and can take several minutes. Later builds are shorter.

## Where the app and disk image are

Tauri names the bundle from `productName` in `src-tauri/tauri.conf.json` (`Multi-AI Chat Hardened`).

- App: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app`
- Disk image: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`

If the filename differs by a space or hyphen, use the file that `pnpm tauri build` prints. Confirm it is arm64:

```bash
file "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app/Contents/MacOS/"*
codesign -dv --verbose=4 "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app"
codesign --verify --deep --strict "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app"
shasum -a 256 "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app/Contents/MacOS/"*
shasum -a 256 src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg
sh scripts/record-build-fingerprint.sh
```

Expect `arm64` and an ad-hoc signature (`Signature=adhoc`). This fork does not add an Apple Developer ID or notarization. The identifier in the signature must be `com.samuelshek.multiaichat.hardened`.

Drag the `.app` from the disk image into `/Applications` if you want it there. The first launch will be blocked by Gatekeeper. Open it once, then within about an hour use **System Settings → Privacy & Security → Open Anyway**.

## What the app writes on macOS

Quit the app before deleting these. The bundle id is `com.samuelshek.multiaichat.hardened`, so none of this is the official app's `com.tedh.multiaichat` data.

Paths the program creates itself:

- `/Applications/Multi-AI Chat Hardened.app` when you copy it there
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/settings.json`
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/session-checkpoint.json` (workflow step and a hash of the question, not the question text)
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/snapshots/` when snapshot saving is turned on
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/webviews/chatgpt/`
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/webviews/grok/`
- `~/Library/Application Support/com.samuelshek.multiaichat.hardened/webviews/gemini/`

On macOS those `webviews/<provider>` directories are created, but WKWebView does not store cookies there. Logins go to the WebKit data stores below.

Paths WebKit and macOS create for this bundle id. The exact subdirectory can vary by macOS version. After the first launch, list them:

```bash
ls -d ~/Library/*/*samuelshek* ~/Library/*/*multiaichat* ~/Library/WebKit/com.samuelshek.multiaichat.hardened/* 2>/dev/null
```

Expect, and delete if present:

- `~/Library/WebKit/com.samuelshek.multiaichat.hardened/WebsiteData/` is the default store used by the local control pane. Conversation text is written here only when **Save conversation text on this Mac** is on.
- `~/Library/WebKit/com.samuelshek.multiaichat.hardened/WebsiteDataStore/C4A7E1B0-6D23-4F58-9A01-7C3E5B8D2F64` is the ChatGPT store (`c4a7e1b0-6d23-4f58-9a01-7c3e5b8d2f64`).
- `~/Library/WebKit/com.samuelshek.multiaichat.hardened/WebsiteDataStore/9B2D6F14-8E70-4C3A-B591-0D6A4E7C1F83` is the Grok store (`9b2d6f14-8e70-4c3a-b591-0d6a4e7c1f83`).
- `~/Library/WebKit/com.samuelshek.multiaichat.hardened/WebsiteDataStore/E85C3A27-1F94-4B60-8D52-6A0C9E3B7D15` is the Gemini store (`e85c3a27-1f94-4b60-8d52-6a0c9e3b7d15`).
- `~/Library/Caches/com.samuelshek.multiaichat.hardened/`
- `~/Library/HTTPStorages/com.samuelshek.multiaichat.hardened/`
- `~/Library/HTTPStorages/com.samuelshek.multiaichat.hardened.binarycookies`
- `~/Library/Saved Application State/com.samuelshek.multiaichat.hardened.savedState/`
- `~/Library/Preferences/com.samuelshek.multiaichat.hardened.plist`
- `~/Library/Logs/com.samuelshek.multiaichat.hardened/` if macOS created it

The `WebsiteDataStore/<UUID>` layout is taken from WebKit's data-store identifier behavior and Wry's notes for `data_store_identifier`. It was not listed on a Mac while this fork was written. Trust the `ls` output on your machine if a directory name differs.

There is no adapter cache directory. This build does not write `adapters-cache/`.

After deleting the files, sign out the app's sessions from the ChatGPT, Grok, and Gemini account-security pages if those sites list this browser.

## Check the login split on the Mac

Linux cannot open WKWebView, so this was not executed here.

1. Launch the app on macOS 14 or later and sign each pane into a different account.
2. Quit and reopen. Each pane should still be signed in.
3. In the WebKit directory above, confirm three data stores with the UUIDs listed, and that signing out of one provider does not sign out the other two.
4. A login window (Google or X) should stay in that provider's store. After it closes, the pane should show the signed-in site without asking you to sign in again.
