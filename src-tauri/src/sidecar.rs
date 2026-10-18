use std::process::Command;
use tauri::AppHandle;

pub fn spawn_engine(app: &AppHandle) -> Result<(), String> {
    let _ = Command::new("python")
        .args(["apps/engine/backend/main.py"])
        .spawn()
        .map_err(|e| format!("failed to spawn engine: {}", e))?;
    Ok(())
}
