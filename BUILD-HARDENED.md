# Build the hardened app on an Apple Silicon Mac

This build is for an Apple Silicon Mac running **macOS 14 or later**. macOS 14 is required for separate ChatGPT, Grok, and Gemini login stores. On macOS 13, WebKit ignores a custom data-store identifier and the three panes share one profile.

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

## Commands

From the repository root, on the commit you intend to run:

```bash
pnpm install --frozen-lockfile
pnpm verify
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg -- --locked
```

`pnpm verify` typechecks, lints, runs the frontend tests, checks the bundled adapters, builds the frontend, and fails if that build or the Rust sources reference `raw.githubusercontent.com`, `api.github.com`, or any other host that is not one of the three providers, their login hosts, or Tauri's local IPC hosts.

`--locked` stops Cargo from changing `Cargo.lock` during the app build.

The first Rust release build compiles the Tauri crates and can take several minutes. Later builds are shorter.

## Where the app and disk image are

Tauri names the bundle from `productName` in `src-tauri/tauri.conf.json` (`Multi-AI Chat Hardened`).

- App: `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app`
- Disk image: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`

If the filename differs by a space or hyphen, use the file that `pnpm tauri build` prints. Confirm it is arm64:

```bash
file "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app/Contents/MacOS/"*
codesign -dv --verbose=4 "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Multi-AI Chat Hardened.app"
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

- `~/Library/WebKit/com.samuelshek.multiaichat.hardened/`
  - `WebsiteData/` is the default store used by the local control pane. Conversation text is written here only when **Save conversation text on this Mac** is on.
  - `WebsiteDataStore/<UUID>/` is the per-provider store. The UUIDs compiled into the app are:
    - ChatGPT `C4A7E1B0-6D23-4F58-9A01-7C3E5B8D2F64`
    - Grok `9B2D6F14-8E70-4C3A-B591-0D6A4E7C1F83`
    - Gemini `E85C3A27-1F94-4B60-8D52-6A0C9E3B7D15`
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
