mod commands;
mod sidecar;
mod state;
mod win32;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::window::ipc_dispatch
        ])
        .setup(|app| {
            let _ = sidecar::spawn_engine(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
