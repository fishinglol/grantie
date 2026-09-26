use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::State;

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
        .invoke_handler(tauri::generate_handler![oauth_start, oauth_wait])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
