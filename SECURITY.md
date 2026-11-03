# Security Policy

## Supported versions

Security fixes are maintained on the latest `main` branch and the latest published GitHub Release. Older releases may be asked to upgrade before a report is investigated.

| Version | Supported |
|---|---|
| Latest published release | Yes |
| Current `main` | Yes |
| Older releases | No |

## Report a vulnerability

Do not open a public issue for a vulnerability or include cookies, account data, conversation text, provider-page HTML, access tokens, or local profile files in a report.

Use GitHub's private **Report a vulnerability** form under the repository Security tab when available. Otherwise email [TED@TED-H.com](mailto:TED@TED-H.com) with the subject `[security] multi-ai-chat-desktop`.

Please include:

- affected app version, commit, operating system, and installation type;
- a minimal reproduction that uses test data and a disposable provider account where possible;
- the expected and observed security boundary;
- whether provider cookies, local files, Tauri commands, adapter updates, or exported diagnostics are involved;
- any suggested mitigation and whether disclosure is time-sensitive.

This is a feature-frozen, best-effort open-source project and does not promise a response SLA. Reports that can expose user data or cross the local/remote trust boundary are prioritized.

## Security boundaries

- Provider pages are untrusted remote content. Their `ai-<provider>` webviews receive no Tauri capability and no `remote.urls` permission.
- Only the bundled local `main` control webview receives the app command capability. Rust commands also verify the calling control webview.
- The bundled control UI uses a production Content Security Policy. Development keeps CSP disabled for the local Vite server.
- This hardened fork does not fetch adapters or check GitHub for updates. Only the ChatGPT, Grok, and Gemini adapters compiled into the build are used.
- On macOS 14 or later, each provider uses its own WKWebView data store. The app has no conversation server, telemetry endpoint, or account backend.
- Debug bundles and Markdown exports are created only after an explicit local action. Adapter diagnostics can be copied to the clipboard. They are not placed in a browser URL.

Provider account security, provider service availability, provider terms, browser-engine vulnerabilities, and a compromised local machine remain outside this application's security boundary.

## 繁體中文摘要

請勿用公開 Issue 回報漏洞，也不要附上 cookie、帳號資料、對話文字、token、provider HTML 或本機 profile。優先使用 GitHub Security 頁面的私人 **Report a vulnerability**；若該功能不可用，請寄信至 [TED@TED-H.com](mailto:TED@TED-H.com)，主旨使用 `[security] multi-ai-chat-desktop`。

遠端 provider webview 沒有 Tauri 權限；只有本機 `main` 控制介面可呼叫 app command。這個強化版不會下載 adapter，也不會把診斷送到 GitHub。
