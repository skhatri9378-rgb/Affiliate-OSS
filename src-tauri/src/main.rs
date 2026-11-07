#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod manager;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
struct Database {
    connection: Mutex<Connection>,
    path: PathBuf,
}
#[tauri::command]
async fn backup_database(state: State<'_, Database>) -> Result<Value, String> {
    let name = format!(
        "Affiliate-Links-{}.sqlite",
        chrono::Local::now().format("%Y-%m-%d-%H%M%S")
    );
    let file = rfd::AsyncFileDialog::new()
        .set_file_name(name)
        .add_filter("SQLite backup", &["sqlite"])
        .save_file()
        .await;
    let Some(file) = file else {
        return Ok(Value::Null);
    };
    let path = file.path();
    if path == state.path
        || std::fs::canonicalize(path).ok() == std::fs::canonicalize(&state.path).ok()
    {
        return Err("Choose a different file from the live database.".into());
    }
    let c = state.connection.lock().map_err(|e| e.to_string())?;
    c.backup(rusqlite::MAIN_DB, path, None)
        .map_err(|e| e.to_string())?;
    Ok(json!({"saved":true}))
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let default = app.path().app_data_dir()?;
            let dir = if cfg!(debug_assertions) {
                std::env::var_os("AFFILIATE_OS_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(default)
            } else {
                default
            };
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("affiliate-os.sqlite");
            let connection = Connection::open(&path)?;
            manager::initialize(&connection).map_err(std::io::Error::other)?;
            app.manage(Database {
                connection: Mutex::new(connection),
                path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            manager::manager_snapshot,
            manager::manager_save_link,
            manager::manager_save_label,
            manager::manager_delete_link,
            manager::manager_delete_label,
            manager::manager_open_url,
            backup_database
        ])
        .run(tauri::generate_context!())
        .expect("Could not launch Affiliate Links");
}
