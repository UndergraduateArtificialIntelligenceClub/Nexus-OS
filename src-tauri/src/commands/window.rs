use serde::{Deserialize, Serialize};
use crate::types::IPCRequest;

#[tauri::command]
pub fn ipc_dispatch(request: IPCRequest) -> Result<IPCResponse, String> {
    match request.command.as_str() {
        "get_desktop_state" => Ok(IPCResponse {
            success: true,
            data: serde_json::to_value(&crate::win32::window::enumerate_windows()).ok(),
            error: None,
        }),
        _ => Ok(IPCResponse {
            success: false,
            data: None,
            error: Some(format!("unknown command: {}", request.command)),
        }),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IPCRequest {
    pub command: String,
    pub args: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IPCResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}
