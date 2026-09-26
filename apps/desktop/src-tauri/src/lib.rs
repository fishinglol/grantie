use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

/// Holds the bound loopback socket between `oauth_start` and `oauth_wait`.
///
/// Google's installed-app flow redirects the browser back to
/// `http://127.0.0.1:<port>/callback?code=…`, so we have to be listening on a
/// port *before* we can build the authorization URL. Hence two commands: one to
/// bind and report the port, one to wait for the single request that follows.
#[derive(Default)]
struct OauthListener(Mutex<Option<TcpListener>>);

/// How long to wait for the user to finish signing in before giving up.
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);

#[tauri::command]
fn oauth_start(state: State<'_, OauthListener>) -> Result<u16, String> {
    // Port 0 = let the OS pick a free one. Bound to loopback only, so nothing
    // outside this machine can reach it.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.0.lock().map_err(|e| e.to_string())? = Some(listener);
    Ok(port)
}

/// Resolves with the raw query string of the redirect, e.g. `code=…&state=…`.
#[tauri::command]
async fn oauth_wait(state: State<'_, OauthListener>) -> Result<String, String> {
    let listener = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard
            .take()
            .ok_or_else(|| "oauth_wait called without a listener; call oauth_start first".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || wait_for_redirect(listener))
        .await
        .map_err(|e| e.to_string())?
}

fn wait_for_redirect(listener: TcpListener) -> Result<String, String> {
    // Non-blocking + poll so the timeout is real; a blocking accept() would
    // leave a thread parked forever if the user just closes the browser tab.
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + AUTH_TIMEOUT;

    loop {
        if Instant::now() > deadline {
            return Err("Timed out waiting for the Google sign-in redirect.".into());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(query) = handle_request(stream) {
                    return Ok(query);
                }
                // Browsers also ask for /favicon.ico — keep listening.
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Returns the query string if this request is the OAuth redirect.
fn handle_request(mut stream: TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let peer_is_local = stream
        .peer_addr()
        .map(|a| a.ip().is_loopback())
        .unwrap_or(false);
    if !peer_is_local {
        return None;
    }

    let mut request_line = String::new();
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    reader.read_line(&mut request_line).ok()?;

    // "GET /callback?code=…&state=… HTTP/1.1"
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = target.split_once('?').map(|(_, q)| q.to_string());

    match query {
        Some(q) if q.contains("code=") || q.contains("error=") => {
            respond(&mut stream, "Granite is connected", "You can close this tab and go back to Granite.");
            Some(q)
        }
        _ => {
            respond(&mut stream, "Granite", "Waiting for Google…");
            None
        }
    }
}

fn respond(stream: &mut TcpStream, title: &str, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"font:16px/1.5 system-ui;display:grid;place-items:center;height:90vh;margin:0;color:#222\">\
         <div style=\"text-align:center\"><h1 style=\"font-size:20px\">{title}</h1><p>{message}</p></div>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Where the Google session lives in the system keychain.
const KEYCHAIN_SERVICE: &str = "dev.granite.desktop";
const SESSION_ACCOUNT: &str = "google-session";

fn session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, SESSION_ACCOUNT).map_err(|e| e.to_string())
}

/// The saved Google session (JSON), or None when there is none.
#[tauri::command]
fn session_load() -> Result<Option<String>, String> {
    match session_entry()?.get_password() {
        Ok(session) => Ok(Some(session)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn session_save(session: String) -> Result<(), String> {
    session_entry()?.set_password(&session).map_err(|e| e.to_string())
}

#[tauri::command]
fn session_clear() -> Result<(), String> {
    match session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Lets the app change files in a vault folder the person chose. The capability file only allows writing to the default
/// `~/Documents/GraniteVault` and the app's config, so a bug in the page can't write anywhere else (e.g. `~/Library/LaunchAgents`).
/// A vault must be a folder inside the home folder, not the home folder itself, not in `~/Library` or `~/Applications`, not hidden.
fn allow_vault_dir(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let home = std::fs::canonicalize(&home).unwrap_or(home);
    let dir = std::fs::canonicalize(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let inside = dir
        .strip_prefix(&home)
        .map_err(|_| format!("{} is not inside your home folder, so it can't be a vault", dir.display()))?;
    let parts: Vec<String> = inside
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    let refused = match parts.first() {
        None => true,
        Some(first) => first == "Library" || first == "Applications" || parts.iter().any(|p| p.starts_with('.')),
    };
    if refused || !dir.is_dir() {
        return Err(format!("{} can't be a vault", dir.display()));
    }
    let scope = app.fs_scope();
    scope.allow_directory(&dir, true).map_err(|e| e.to_string())?;
    // `**` does not match dot-folders on macOS/Linux; `.granite` (plugins, sync bookkeeping) belongs to the vault.
    scope.allow_directory(dir.join(".granite"), true).map_err(|e| e.to_string())
}

#[tauri::command]
fn allow_vault(app: AppHandle, dir: String) -> Result<(), String> {
    allow_vault_dir(&app, Path::new(&dir))
}

/// The vaults saved in `vault-config.json` (the active one and recent ones) are allowed again at every launch.
fn allow_saved_vaults(app: &AppHandle) {
    let Ok(config) = app.path().app_config_dir() else { return };
    let Ok(text) = std::fs::read_to_string(config.join("vault-config.json")) else { return };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let recent = json["recentVaults"].as_array().cloned().unwrap_or_default();
    for dir in std::iter::once(&json["activeVaultDir"]).chain(recent.iter()).filter_map(|v| v.as_str()) {
        let _ = allow_vault_dir(app, Path::new(dir));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Two copies of the app would sync the same vault against the same Drive folder and fork every note into
    // "(Drive copy …)" files, so a second launch just brings the first window forward. Must be the first plugin.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(OauthListener::default())
        .setup(|app| {
            allow_saved_vaults(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![oauth_start, oauth_wait, session_load, session_save, session_clear, allow_vault])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
