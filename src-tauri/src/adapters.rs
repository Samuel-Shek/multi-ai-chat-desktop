use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum Detector {
    Selector(String),
    Detailed(DetectorObject),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectorObject {
    pub selector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_includes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_excludes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Adapter {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "adapterVersion")]
    pub adapter_version: u32,
    pub provider: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub urls: AdapterUrls,
    #[serde(rename = "inputSelectors")]
    pub input_selectors: Vec<String>,
    #[serde(rename = "sendButtonSelectors")]
    pub send_button_selectors: Vec<String>,
    #[serde(rename = "responseSelectors")]
    pub response_selectors: Vec<String>,
    #[serde(rename = "loginDetectors")]
    pub login_detectors: Vec<String>,
    #[serde(rename = "loggedOutDetectors", default)]
    pub logged_out_detectors: Vec<Detector>,
    #[serde(rename = "thinkingDetectors", default)]
    pub thinking_detectors: Vec<Detector>,
    #[serde(rename = "stopButtonSelectors", default)]
    pub stop_button_selectors: Vec<String>,
    #[serde(rename = "inputStrategy")]
    pub input_strategy: String,
    #[serde(rename = "sendStrategy")]
    pub send_strategy: String,
    pub timing: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AdapterUrls {
    pub app: String,
    pub login: String,
    #[serde(rename = "match")]
    pub match_patterns: Vec<String>,
    #[serde(rename = "ssoMatch", default)]
    pub sso_match: Vec<String>,
}

static ADAPTERS: OnceLock<HashMap<String, Adapter>> = OnceLock::new();
static BROKEN_ADAPTERS: OnceLock<HashSet<String>> = OnceLock::new();

#[tauri::command]
pub async fn adapter_push(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<(), String> {
    crate::webviews::ensure_control_webview(&webview)?;
    crate::webviews::push_engine_and_adapter(&app, &provider)
}

#[tauri::command]
pub async fn report_broken(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    provider: String,
) -> Result<String, String> {
    crate::webviews::ensure_control_webview(&webview)?;
    let adapter = get_adapter(&provider)?;
    let adapter_json = serde_json::to_string(&adapter).map_err(|error| error.to_string())?;
    let app_version = serde_json::to_string(&app.package_info().version.to_string())
        .map_err(|error| error.to_string())?;
    let js = format!(
        "window.__MAC_REPORT__ ? window.__MAC_REPORT__.collect({adapter_json}, {app_version}) : null"
    );
    let raw =
        crate::webviews::eval_provider_with_callback_from_control(&app, &provider, &js).await?;
    if raw.trim() == "null" {
        return Err("diagnostics unavailable - open the provider and try again".to_string());
    }
    Ok(raw)
}

pub(crate) fn get_adapter(provider: &str) -> Result<Adapter, String> {
    adapters()
        .get(provider)
        .cloned()
        .ok_or_else(|| format!("unknown provider: {provider}"))
}

pub(crate) fn all_provider_states() -> Vec<String> {
    let mut providers = vec!["chatgpt", "gemini", "grok"]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    providers.sort();
    providers
}

pub(crate) fn broken_adapters() -> HashSet<String> {
    init_adapters();
    BROKEN_ADAPTERS.get().cloned().unwrap_or_default()
}

fn adapters() -> &'static HashMap<String, Adapter> {
    init_adapters();
    ADAPTERS.get().expect("adapters OnceLock initialized")
}

fn init_adapters() {
    if ADAPTERS.get().is_some() {
        return;
    }
    let mut map = HashMap::new();
    let mut broken = HashSet::new();
    for (provider, text) in [
        ("chatgpt", include_str!("../../adapters/chatgpt.json")),
        ("gemini", include_str!("../../adapters/gemini.json")),
        ("grok", include_str!("../../adapters/grok.json")),
    ] {
        match serde_json::from_str::<Adapter>(text)
            .map_err(|error| error.to_string())
            .and_then(|adapter| {
                validate_adapter(&adapter)?;
                Ok(adapter)
            }) {
            Ok(adapter) => {
                map.insert(provider.to_string(), adapter);
            }
            Err(error) => {
                eprintln!("[MAC adapters] bundled adapter {provider} invalid: {error}");
                broken.insert(provider.to_string());
            }
        }
    }
    let _ = BROKEN_ADAPTERS.set(broken);
    let _ = ADAPTERS.set(map);
}

pub(crate) fn validate_adapter(adapter: &Adapter) -> Result<(), String> {
    if !matches!(adapter.schema_version, 1 | 2) {
        return Err("unsupported schemaVersion".into());
    }
    if adapter.schema_version == 1
        && adapter
            .logged_out_detectors
            .iter()
            .any(|detector| matches!(detector, Detector::Detailed(_)))
    {
        return Err("loggedOutDetectors object form requires schemaVersion 2".into());
    }
    if adapter.adapter_version == 0 {
        return Err("adapterVersion must be positive".into());
    }
    for (name, values) in [
        ("urls.match", &adapter.urls.match_patterns),
        ("inputSelectors", &adapter.input_selectors),
        ("sendButtonSelectors", &adapter.send_button_selectors),
        ("responseSelectors", &adapter.response_selectors),
        ("loginDetectors", &adapter.login_detectors),
    ] {
        if values.is_empty() {
            return Err(format!("{name} must be non-empty"));
        }
        if values.iter().any(|value| value.trim().is_empty()) {
            return Err(format!("{name} entries must be non-empty"));
        }
    }
    validate_detectors("loggedOutDetectors", &adapter.logged_out_detectors)?;
    validate_detectors("thinkingDetectors", &adapter.thinking_detectors)?;
    if adapter
        .stop_button_selectors
        .iter()
        .any(|value| value.trim().is_empty())
    {
        return Err("stopButtonSelectors entries must be non-empty".into());
    }
    if !matches!(
        adapter.input_strategy.as_str(),
        "default" | "prosemirror-paste" | "quill-angular"
    ) {
        return Err("invalid inputStrategy".into());
    }
    if !matches!(adapter.send_strategy.as_str(), "click" | "enter") {
        return Err("invalid sendStrategy".into());
    }
    for (name, value) in [
        ("urls.app", adapter.urls.app.as_str()),
        ("urls.login", adapter.urls.login.as_str()),
    ] {
        parse_adapter_url_scope(value).map_err(|error| format!("{name}: {error}"))?;
    }
    for (name, values) in [
        ("urls.match", &adapter.urls.match_patterns),
        ("urls.ssoMatch", &adapter.urls.sso_match),
    ] {
        for value in values {
            parse_adapter_url_scope(value).map_err(|error| format!("{name}: {error}"))?;
        }
    }
    Ok(())
}

fn validate_detectors(name: &str, detectors: &[Detector]) -> Result<(), String> {
    for detector in detectors {
        match detector {
            Detector::Selector(selector) if selector.trim().is_empty() => {
                return Err(format!("{name} selector must be non-empty"));
            }
            Detector::Detailed(detector) => {
                if detector.selector.trim().is_empty() {
                    return Err(format!("{name} selector must be non-empty"));
                }
                for value in [&detector.text_includes, &detector.text_excludes]
                    .into_iter()
                    .flatten()
                {
                    if value.trim().is_empty() {
                        return Err(format!("{name} text filters must be non-empty"));
                    }
                }
            }
            Detector::Selector(_) => {}
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct AdapterUrlScope {
    host: String,
    path: String,
}

fn parse_adapter_url_scope(value: &str) -> Result<AdapterUrlScope, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("URL scope must not be empty".into());
    }
    let wildcard = value.ends_with("/*");
    let base = value.strip_suffix("/*").unwrap_or(value);
    let normalized = if base.starts_with("https://") {
        base.to_string()
    } else if wildcard && !base.contains('/') {
        format!("https://{base}")
    } else {
        return Err(format!("URL scope must use https: {value}"));
    };
    let url = tauri::Url::parse(&normalized).map_err(|_| format!("invalid URL scope: {value}"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!("invalid HTTPS URL scope: {value}"));
    }
    if wildcard && url.path() != "/" {
        return Err(format!("wildcard URL scope must target a host: {value}"));
    }
    Ok(AdapterUrlScope {
        host: url.host_str().unwrap_or_default().to_ascii_lowercase(),
        path: if wildcard {
            "/".to_string()
        } else {
            url.path().to_string()
        },
    })
}

fn app_hosts_from_adapter(adapter: &Adapter) -> Result<Vec<String>, String> {
    let mut hosts: Vec<String> = Vec::new();
    for pattern in &adapter.urls.match_patterns {
        let scope =
            parse_adapter_url_scope(pattern).map_err(|error| format!("urls.match: {error}"))?;
        if !hosts.contains(&scope.host) {
            hosts.push(scope.host);
        }
    }
    let login = parse_adapter_url_scope(&adapter.urls.login)
        .map_err(|error| format!("urls.login: {error}"))?;
    if !hosts.contains(&login.host) {
        hosts.push(login.host);
    }
    Ok(hosts)
}

/// Exact hosts of the provider's own app surface (`urls.match` plus the login URL's host). The
/// document-start bridge is scoped to these hosts so SSO/auth documents stay stock: rotating
/// `document.title` or patching `history` on an identity-provider page interferes with login
/// flows and their embedded challenge widgets.
pub(crate) fn app_hosts_for_provider(provider: &str) -> Result<Vec<String>, String> {
    app_hosts_from_adapter(&get_adapter(provider)?)
}

pub(crate) fn url_allowed_for_provider(provider: &str, url: &tauri::Url) -> Result<bool, String> {
    let adapter = get_adapter(provider)?;
    if login_url_matches(&adapter.urls.login, url) {
        return Ok(true);
    }
    if adapter
        .urls
        .match_patterns
        .iter()
        .any(|pattern| url_matches(pattern, url))
    {
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn url_allowed_for_sso(provider: &str, url: &tauri::Url) -> Result<bool, String> {
    const SHARED: &[&str] = &[
        "accounts.google.com",
        "accounts.youtube.com",
        "appleid.apple.com",
        "login.microsoftonline.com",
        "login.live.com",
    ];
    // SHARED IdP hosts + generic Google regional ccTLD: https ONLY.
    if url.scheme() == "https" {
        let host = url.host_str().unwrap_or_default();
        if SHARED.contains(&host) || is_accounts_google_cctld(host) {
            return Ok(true);
        }
    }
    let adapter = get_adapter(provider)?;
    Ok(adapter
        .urls
        .sso_match
        .iter()
        .any(|pattern| url_matches(pattern, url)))
}

/// Bounded Google regional login hosts:
///   accounts.google.com.<ccTLD>  (e.g. accounts.google.com.tw)
///   accounts.google.<ccTLD>      (e.g. accounts.google.de)
/// A ccTLD is a SINGLE 2-char lowercase-ascii label (ISO 3166-1 alpha-2). Restricting to exactly 2
/// chars covers every real ccTLD while rejecting 3-char gTLDs (accounts.google.net/.org). Rejects
/// spoofs like accounts.google.evil.com, accounts.google.com.tw.evil.net, accounts.google.co.uk.evil.
fn is_accounts_google_cctld(host: &str) -> bool {
    if let Some(rest) = host.strip_prefix("accounts.google.com.") {
        return is_single_cctld_label(rest);
    }
    if let Some(rest) = host.strip_prefix("accounts.google.") {
        return is_single_cctld_label(rest);
    }
    false
}

fn is_single_cctld_label(s: &str) -> bool {
    s.len() == 2 && s.chars().all(|c| c.is_ascii_lowercase())
}

pub(crate) fn url_matches_provider_app(provider: &str, url: &tauri::Url) -> Result<bool, String> {
    let adapter = get_adapter(provider)?;
    Ok(adapter
        .urls
        .match_patterns
        .iter()
        .any(|pattern| url_matches(pattern, url)))
}

fn url_matches(pattern: &str, url: &tauri::Url) -> bool {
    if !plain_https_url(url) {
        return false;
    }
    if let Some(prefix) = pattern.strip_suffix("/*") {
        let host = url.host_str().unwrap_or_default();
        let prefix = prefix.trim_start_matches("https://");
        host == prefix
    } else {
        tauri::Url::parse(pattern).ok().is_some_and(|expected| {
            expected.scheme() == "https"
                && expected.host_str() == url.host_str()
                && path_matches_prefix(expected.path(), url.path())
        })
    }
}

fn plain_https_url(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}

fn path_matches_prefix(expected: &str, actual: &str) -> bool {
    actual == expected
        || actual
            .strip_prefix(expected)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn login_url_matches(login: &str, url: &tauri::Url) -> bool {
    if !plain_https_url(url) {
        return false;
    }
    tauri::Url::parse(login).ok().is_some_and(|expected| {
        expected.scheme() == "https"
            && expected.host_str() == url.host_str()
            && path_matches_prefix(expected.path(), url.path())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_adapters_validate() {
        for adapter in adapters().values() {
            validate_adapter(adapter).unwrap();
        }
    }

    #[test]
    fn app_hosts_cover_the_app_surface_but_never_sso_hosts() {
        let hosts = app_hosts_for_provider("chatgpt").unwrap();
        assert!(hosts.contains(&"chatgpt.com".to_string()));
        assert!(hosts.contains(&"chat.openai.com".to_string()));
        assert!(!hosts.contains(&"auth.openai.com".to_string()));
        assert!(!hosts.contains(&"auth0.openai.com".to_string()));

        for provider in ["chatgpt", "gemini", "grok"] {
            assert!(!app_hosts_for_provider(provider).unwrap().is_empty());
        }
    }

    #[test]
    fn app_host_collection_fails_closed_on_invalid_match_or_login_urls() {
        let mut adapter = adapters().get("chatgpt").unwrap().clone();
        adapter.urls.match_patterns = vec!["http://chatgpt.com/*".into()];
        assert!(app_hosts_from_adapter(&adapter)
            .unwrap_err()
            .starts_with("urls.match:"));

        adapter = adapters().get("chatgpt").unwrap().clone();
        adapter.urls.login = "http://chatgpt.com/auth/login".into();
        assert!(app_hosts_from_adapter(&adapter)
            .unwrap_err()
            .starts_with("urls.login:"));
    }

    #[test]
    fn logged_out_detector_objects_require_schema_version_two() {
        let mut adapter = adapters().get("grok").unwrap().clone();
        assert_eq!(adapter.schema_version, 2);
        validate_adapter(&adapter).unwrap();

        adapter.schema_version = 1;
        assert_eq!(
            validate_adapter(&adapter).unwrap_err(),
            "loggedOutDetectors object form requires schemaVersion 2"
        );

        adapter.schema_version = 3;
        assert_eq!(
            validate_adapter(&adapter).unwrap_err(),
            "unsupported schemaVersion"
        );
    }

    #[test]
    fn malformed_detector_objects_fail_closed() {
        let source = serde_json::to_value(adapters().get("grok").unwrap()).unwrap();
        for detectors in [
            serde_json::json!([null]),
            serde_json::json!([{ "selector": "button", "unexpected": true }]),
        ] {
            let mut candidate = source.clone();
            candidate["loggedOutDetectors"] = detectors;
            assert!(serde_json::from_value::<Adapter>(candidate).is_err());
        }
    }

    #[test]
    fn detector_validation_rejects_empty_selector_or_text_filter() {
        let mut adapter = adapters().get("grok").unwrap().clone();
        adapter.logged_out_detectors = vec![Detector::Detailed(DetectorObject {
            selector: " ".into(),
            text_includes: Some("Sign in".into()),
            text_excludes: None,
        })];
        assert!(validate_adapter(&adapter)
            .unwrap_err()
            .contains("selector must be non-empty"));

        adapter.logged_out_detectors = vec![Detector::Detailed(DetectorObject {
            selector: "button".into(),
            text_includes: Some("".into()),
            text_excludes: None,
        })];
        assert!(validate_adapter(&adapter)
            .unwrap_err()
            .contains("text filters must be non-empty"));
    }

    #[test]
    fn adapter_url_scopes_reject_credentials_ports_queries_and_non_https() {
        for value in [
            "http://chatgpt.com",
            "https://user:pass@chatgpt.com",
            "https://chatgpt.com:8443",
            "https://chatgpt.com?next=example.com",
            "chatgpt.com/path",
            "https://chatgpt.com/path/*",
        ] {
            assert!(parse_adapter_url_scope(value).is_err(), "{value}");
        }
    }

    #[test]
    fn navigation_match_table() {
        let url = tauri::Url::parse("https://chatgpt.com/c/123").unwrap();
        assert!(url_allowed_for_provider("chatgpt", &url).unwrap());
        let external = tauri::Url::parse("https://example.com").unwrap();
        assert!(!url_allowed_for_provider("chatgpt", &external).unwrap());
        let sso = tauri::Url::parse("https://accounts.google.com/o/oauth2").unwrap();
        assert!(url_allowed_for_sso("gemini", &sso).unwrap());
    }

    #[test]
    fn provider_sso_match_table_allows_seed_patterns() {
        for (provider, value) in [
            ("chatgpt", "https://auth.openai.com/authorize"),
            ("chatgpt", "https://auth0.openai.com/u/login"),
            ("chatgpt", "https://gsi.google.com/client"),
            ("chatgpt", "https://www.google.com/accounts/ServiceLogin"),
            (
                "gemini",
                "https://www.google.com/sorry/index?continue=https%3A%2F%2Fgemini.google.com%2Fapp",
            ),
            ("grok", "https://x.com/i/oauth2/authorize"),
            ("grok", "https://twitter.com/i/oauth2/authorize"),
            ("grok", "https://accounts.x.ai/session"),
            (
                "grok",
                "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b",
            ),
            ("grok", "https://accounts.google.com/o/oauth2/v2/auth"),
            ("grok", "https://accounts.google.de/ServiceLogin"),
            ("chatgpt", "https://accounts.google.com.tw/accounts/SetSID"),
            ("grok", "https://accounts.google.com.tw/accounts/SetSID"),
            (
                "grok",
                "https://auth.grokusercontent.com/api/auth/callback/google",
            ),
            ("grok", "https://auth.grok.com/oauth/authorize"),
            ("grok", "https://auth.grokipedia.com/login"),
            ("grok", "https://gsi.google.com/client"),
            ("grok", "https://www.google.com/accounts/ServiceLogin"),
        ] {
            let url = tauri::Url::parse(value).unwrap();
            assert!(
                url_allowed_for_sso(provider, &url).unwrap(),
                "{provider} {value}"
            );
        }
    }

    #[test]
    fn provider_sso_match_table_denies_prefix_scheme_and_cross_provider() {
        for (provider, value) in [
            ("chatgpt", "https://auth.openai.com.evil.net/"),
            ("chatgpt", "http://auth.openai.com/"),
            ("grok", "https://grok.community/"),
            ("grok", "http://accounts.google.com/"),
            ("grok", "https://accounts.google.evil.com/"),
            ("grok", "https://accounts.google.net/"),
            ("grok", "https://accounts.google.com.net/"),
            ("grok", "https://accounts.google.com.tw.evil.net/"),
            ("grok", "http://accounts.google.com.tw/"),
            ("grok", "https://auth.grokipedia.com.evil.net/"),
            ("grok", "https://auth.grokusercontent.com.evil.net/"),
            ("grok", "https://auth.grok.com.evil.net/"),
            ("grok", "https://auth.x.ai/oauth/authorize"),
            ("grok", "https://auth.x.ai.evil.net/"),
            ("grok", "http://auth.x.ai/"),
            ("gemini", "https://www.google.com/search"),
            ("gemini", "https://www.google.com/sorryevil"),
            ("gemini", "https://www.google.com.evil.net/sorry"),
            ("gemini", "http://www.google.com/sorry"),
            ("chatgpt", "https://www.google.com/sorry/index"),
            ("grok", "https://www.google.com/sorry/index"),
        ] {
            let url = tauri::Url::parse(value).unwrap();
            assert!(
                !url_allowed_for_sso(provider, &url).unwrap(),
                "{provider} {value}"
            );
        }
    }

    #[test]
    fn navigation_denies_prefix_and_non_https_bypasses() {
        for value in [
            "https://grok.community",
            "https://grok.com.evil.net",
            "http://grok.com",
        ] {
            let url = tauri::Url::parse(value).unwrap();
            assert!(!url_allowed_for_provider("grok", &url).unwrap());
        }
    }

    #[test]
    fn shipped_provider_login_and_app_paths_keep_shared_matcher_parity() {
        for (provider, login, deep_app, http_app) in [
            (
                "chatgpt",
                "https://chatgpt.com/auth/login",
                "https://chatgpt.com/c/123",
                "http://chatgpt.com/c/123",
            ),
            (
                "gemini",
                "https://gemini.google.com/app",
                "https://gemini.google.com/app/123",
                "http://gemini.google.com/app/123",
            ),
            (
                "grok",
                "https://grok.com",
                "https://grok.com/chat/123",
                "http://grok.com/chat/123",
            ),
        ] {
            let login = tauri::Url::parse(login).unwrap();
            assert!(
                url_allowed_for_provider(provider, &login).unwrap(),
                "{provider} login"
            );

            let deep_app = tauri::Url::parse(deep_app).unwrap();
            assert!(
                url_allowed_for_provider(provider, &deep_app).unwrap(),
                "{provider} deep app"
            );

            let http_app = tauri::Url::parse(http_app).unwrap();
            assert!(
                !url_allowed_for_provider(provider, &http_app).unwrap(),
                "{provider} http denied"
            );
        }
    }
}
