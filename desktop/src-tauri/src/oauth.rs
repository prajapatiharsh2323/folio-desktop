//! Google Drive OAuth (09 §2).
//!
//! Installed-app loopback flow with PKCE, per current Google policy:
//!
//! - bind an ephemeral `127.0.0.1` listener,
//! - open the consent URL in the system browser,
//! - wait for `/callback?code=…&state=…`,
//! - exchange the code server-side (Rust) with the PKCE verifier,
//! - keep the access token in memory (returned to the frontend) and the
//!   refresh token in Windows Credential Manager.
//!
//! Scope is `drive.file` only, so Folio can see only the files it created.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const KEYRING_SERVICE: &str = "com.folio.desktop";
const KEYRING_USER: &str = "google-drive-refresh-token";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Debug, Clone, Serialize)]
pub struct OAuthTokens {
    pub access_token: String,
    /// Unix epoch milliseconds.
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn fail(kind: &str, message: impl std::fmt::Display) -> String {
    format!("{kind}:{message}")
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| fail("AUTH", e))
}

fn store_refresh_token(token: &str) -> Result<(), String> {
    keyring_entry()?
        .set_password(token)
        .map_err(|e| fail("AUTH", e))
}

fn load_refresh_token() -> Result<String, String> {
    keyring_entry()?
        .get_password()
        .map_err(|_| fail("AUTH", "not signed in"))
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("Folio-Desktop/0.1")
        .build()
        .map_err(|e| fail("NETWORK", e))
}

fn parse_token_response(body: &str, status: u16) -> Result<(String, Option<String>, i64), String> {
    let parsed: TokenResponse = serde_json::from_str(body).map_err(|e| {
        fail(
            "NETWORK",
            format!("token response was not JSON (HTTP {status}): {e}"),
        )
    })?;
    if let Some(error) = parsed.error {
        let detail = parsed.error_description.unwrap_or_default();
        let kind = if error == "invalid_grant" || error == "invalid_client" {
            "AUTH"
        } else {
            "NETWORK"
        };
        return Err(fail(kind, format!("{error} {detail}").trim().to_string()));
    }
    let access = parsed
        .access_token
        .filter(|s| !s.is_empty())
        .ok_or_else(|| fail("AUTH", "token response had no access_token"))?;
    let expires_in = parsed.expires_in.unwrap_or(3500).max(60);
    Ok((access, parsed.refresh_token, now_ms() + expires_in * 1000))
}

fn exchange_code(
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<(OAuthTokens, Option<String>), String> {
    let client = http_client()?;
    let mut form = vec![
        ("code", code.to_string()),
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("code_verifier", verifier.to_string()),
    ];
    if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
        form.push(("client_secret", secret.to_string()));
    }
    let response = client
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .map_err(|e| fail("NETWORK", e))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|e| fail("NETWORK", format!("reading token response: {e}")))?;
    let (access, refresh, expires_at) = parse_token_response(&body, status)?;
    Ok((
        OAuthTokens {
            access_token: access,
            expires_at,
        },
        refresh,
    ))
}

fn respond(stream: &mut std::net::TcpStream, status: &str, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Folio</title>\
         <style>body{{font-family:system-ui;background:#FAFAF7;color:#1C1B19;\
         display:grid;place-items:center;height:100vh;margin:0}}\
         p{{max-width:32rem;text-align:center;line-height:1.5}}</style></head>\
         <body><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<(String, String), String> {
    let redirect_uri = {
        let addr = listener.local_addr().map_err(|e| fail("NETWORK", e))?;
        format!("http://127.0.0.1:{}", addr.port())
    };
    listener
        .set_nonblocking(true)
        .map_err(|e| fail("NETWORK", e))?;
    let deadline = Instant::now() + CALLBACK_TIMEOUT;

    loop {
        if Instant::now() > deadline {
            return Err(fail("AUTH", "sign-in timed out — try again"));
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("");
                let Some((_, query)) = target.split_once('?') else {
                    respond(&mut stream, "404 Not Found", "Waiting for Google sign-in…");
                    continue;
                };
                let params = url::form_urlencoded::parse(query.as_bytes());
                let mut code = None;
                let mut state = None;
                let mut error = None;
                for (k, v) in params {
                    match k.as_ref() {
                        "code" => code = Some(v.to_string()),
                        "state" => state = Some(v.to_string()),
                        "error" => error = Some(v.to_string()),
                        _ => {}
                    }
                }
                if let Some(error) = error {
                    respond(
                        &mut stream,
                        "400 Bad Request",
                        "Folio was not granted access. You can close this window.",
                    );
                    return Err(fail("AUTH", format!("access not granted: {error}")));
                }
                let (Some(code), Some(state)) = (code, state) else {
                    respond(&mut stream, "404 Not Found", "Waiting for Google sign-in…");
                    continue;
                };
                if state != expected_state {
                    respond(
                        &mut stream,
                        "400 Bad Request",
                        "Sign-in state did not match. Please try again.",
                    );
                    return Err(fail("AUTH", "OAuth state mismatch"));
                }
                respond(
                    &mut stream,
                    "200 OK",
                    "Folio is connected to Google Drive. You can close this window.",
                );
                return Ok((code, redirect_uri));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(fail("NETWORK", e)),
        }
    }
}

/// Run the full interactive consent flow. Blocking; call from
/// `spawn_blocking` so the Tauri main thread stays responsive.
fn authorize_blocking(
    app: &AppHandle,
    client_id: &str,
    client_secret: Option<&str>,
) -> Result<OAuthTokens, String> {
    if client_id.trim().is_empty() {
        return Err(fail(
            "AUTH",
            "Google OAuth client ID is not configured (VITE_GOOGLE_CLIENT_ID)",
        ));
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| fail("NETWORK", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| fail("NETWORK", e))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_b64(64);
    let challenge = pkce_challenge(&verifier);
    let state = random_b64(24);

    let mut auth_url = url::Url::parse(AUTH_ENDPOINT).map_err(|e| fail("AUTH", e))?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "true")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);

    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| fail("AUTH", format!("could not open the browser: {e}")))?;

    let (code, redirect_uri) = wait_for_code(&listener, &state)?;
    let (tokens, refresh) =
        exchange_code(client_id, client_secret, &code, &redirect_uri, &verifier)?;
    if let Some(refresh) = refresh.filter(|r| !r.is_empty()) {
        store_refresh_token(&refresh)?;
    }
    Ok(tokens)
}

/// Interactive sign-in. Returns the access token (memory only).
#[tauri::command]
pub async fn oauth_sign_in(
    app: AppHandle,
    client_id: String,
    client_secret: Option<String>,
) -> Result<OAuthTokens, String> {
    tauri::async_runtime::spawn_blocking(move || {
        authorize_blocking(&app, &client_id, client_secret.as_deref())
    })
    .await
    .map_err(|e| fail("AUTH", format!("sign-in task failed: {e}")))?
}

/// Silent refresh using the Credential Manager refresh token.
#[tauri::command]
pub async fn oauth_refresh(
    client_id: String,
    client_secret: Option<String>,
) -> Result<OAuthTokens, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let refresh = load_refresh_token()?;
        let client = http_client()?;
        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh),
            ("client_id", client_id),
        ];
        if let Some(secret) = client_secret.filter(|s| !s.is_empty()) {
            form.push(("client_secret", secret));
        }
        let response = client
            .post(TOKEN_ENDPOINT)
            .form(&form)
            .send()
            .map_err(|e| fail("NETWORK", e))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .map_err(|e| fail("NETWORK", format!("reading token response: {e}")))?;
        let (access, _refresh, expires_at) = parse_token_response(&body, status)?;
        Ok(OAuthTokens {
            access_token: access,
            expires_at,
        })
    })
    .await
    .map_err(|e| fail("NETWORK", format!("refresh task failed: {e}")))?
}

/// True when a refresh token is present in Windows Credential Manager.
#[tauri::command]
pub fn oauth_status() -> bool {
    load_refresh_token().is_ok()
}

/// Disconnect: delete the refresh token, leave Drive contents intact.
#[tauri::command]
pub fn oauth_sign_out() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        // Already absent is success.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(fail("AUTH", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_sha256_base64url() {
        // RFC 7636 appendix B vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(pkce_challenge(verifier), expected);
    }

    #[test]
    fn token_errors_are_classified() {
        let auth = parse_token_response(
            r#"{"error":"invalid_grant","error_description":"Bad Request"}"#,
            400,
        )
        .unwrap_err();
        assert!(auth.starts_with("AUTH:"), "{auth}");

        let network = parse_token_response(
            r#"{"error":"backend_error","error_description":"try later"}"#,
            503,
        )
        .unwrap_err();
        assert!(network.starts_with("NETWORK:"), "{network}");
    }

    #[test]
    fn token_success_returns_expiry() {
        let (access, refresh, expires_at) = parse_token_response(
            r#"{"access_token":"ya29.test","refresh_token":"1//r","expires_in":3600}"#,
            200,
        )
        .unwrap();
        assert_eq!(access, "ya29.test");
        assert_eq!(refresh.as_deref(), Some("1//r"));
        assert!(expires_at > now_ms());
    }
}
