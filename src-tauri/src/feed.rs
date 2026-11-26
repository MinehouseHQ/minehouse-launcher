//! Лента www.minehouse.pro/feed в панели справа (API: /api/launcher/feed/*).
//!
//! Вход без Discord и без передачи токена Minecraft сайту: сайт выдаёт serverId,
//! лаунчер шлёт его в sessionserver.mojang.com/session/minecraft/join, как клиент
//! при входе на online-mode сервер, а сайт проверяет hasJoined и выдаёт свой
//! токен сессии. Он лежит в `feed-session.json` в папке лаунчера.

use std::path::{Path, PathBuf};

use minehouse_core::auth::Account;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, LogicalSize, Manager};

fn api(action: &str) -> String {
    format!("{}/api/launcher/feed/{action}", minehouse_core::SITE)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Stored {
    pub token: String,
    /// Ник лицензии, которой выдан токен: другой аккаунт = новый вход.
    pub name: String,
}

fn file(root: &Path) -> PathBuf {
    root.join("feed-session.json")
}

pub fn load(root: &Path) -> Option<Stored> {
    serde_json::from_slice(&std::fs::read(file(root)).ok()?).ok()
}

pub fn clear(root: &Path) {
    let _ = std::fs::remove_file(file(root));
}

fn save(root: &Path, s: &Stored) -> anyhow::Result<()> {
    std::fs::create_dir_all(root)?;
    let path = file(root);
    std::fs::write(&path, serde_json::to_vec(s)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// Разобрать ответ сайта: JSON и при ошибке текст из поля error.
async fn read(res: reqwest::Response) -> Result<Value, String> {
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        if let Some(e) = body.get("error").and_then(Value::as_str) {
            return Err(e.to_string());
        }
        return Err(format!("Сайт ответил {status}"));
    }
    Ok(body)
}

/// Вход в ленту аккаунтом Minecraft (аккаунт уже обновлён и свежий).
pub async fn login(
    client: &reqwest::Client,
    root: &Path,
    account: &Account,
) -> Result<Value, String> {
    let name = &account.session.name;
    let challenge = read(
        client
            .post(api("challenge"))
            .json(&json!({ "name": name }))
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?;
    let server_id = challenge
        .get("server_id")
        .and_then(Value::as_str)
        .ok_or("Сайт не выдал serverId")?
        .to_string();

    let joined = client
        .post("https://sessionserver.mojang.com/session/minecraft/join")
        .json(&json!({
            "accessToken": account.session.access_token,
            "selectedProfile": account.session.uuid.replace('-', ""),
            "serverId": server_id,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !joined.status().is_success() {
        return Err(format!("Mojang не подтвердил вход ({})", joined.status()));
    }

    let session = read(
        client
            .post(api("session"))
            .json(&json!({ "name": name, "server_id": server_id }))
            .send()
            .await
            .map_err(|e| e.to_string())?,
    )
    .await?;
    let token = session
        .get("token")
        .and_then(Value::as_str)
        .ok_or("Сайт не выдал токен")?
        .to_string();
    save(
        root,
        &Stored {
            token,
            name: name.clone(),
        },
    )
    .map_err(|e| format!("{e:#}"))?;
    Ok(session.get("me").cloned().unwrap_or(Value::Null))
}

pub async fn get(
    client: &reqwest::Client,
    root: &Path,
    action: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    let mut req = client.get(api(action)).query(query);
    if let Some(s) = load(root) {
        req = req.bearer_auth(s.token);
    }
    read(req.send().await.map_err(|e| e.to_string())?).await
}

pub async fn post(
    client: &reqwest::Client,
    root: &Path,
    action: &str,
    body: Value,
) -> Result<Value, String> {
    let mut req = client.post(api(action)).json(&body);
    if let Some(s) = load(root) {
        req = req.bearer_auth(s.token);
    }
    read(req.send().await.map_err(|e| e.to_string())?).await
}

/// Расширить окно вправо на `width` (или сузить обратно). Развёрнутое окно не трогаем:
/// панель тогда просто занимает место справа.
pub fn resize(handle: &AppHandle, open: bool, width: f64) -> Result<bool, String> {
    let win = handle.get_webview_window("main").ok_or("Нет окна")?;
    if win.is_maximized().unwrap_or(false) || win.is_fullscreen().unwrap_or(false) {
        return Ok(false);
    }
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let size = win
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let (min_w, min_h) = (760.0, 520.0);
    let new_w = if open {
        size.width + width
    } else {
        (size.width - width).max(min_w)
    };
    // Не уезжаем за правый край экрана: сдвигаем окно влево, сколько нужно.
    if open {
        if let (Ok(Some(monitor)), Ok(pos), Ok(outer)) = (
            win.current_monitor(),
            win.outer_position(),
            win.outer_size(),
        ) {
            let right = monitor.position().x + monitor.size().width as i32;
            let over = pos.x + outer.width as i32 + (width * scale) as i32 - right;
            if over > 0 {
                let x = (pos.x - over).max(monitor.position().x);
                let _ = win.set_position(tauri::PhysicalPosition::new(x, pos.y));
            }
        }
    }
    let _ = win.set_min_size(Some(LogicalSize::new(
        if open { min_w + width } else { min_w },
        min_h,
    )));
    win.set_size(LogicalSize::new(new_w, size.height))
        .map_err(|e| e.to_string())?;
    Ok(true)
}
