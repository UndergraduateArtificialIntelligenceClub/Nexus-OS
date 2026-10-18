use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopState {
    pub windows: Vec<WindowInfo>,
    pub monitors: Vec<MonitorInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub focused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: i32,
    pub resolution: String,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            windows: vec![],
            monitors: vec![],
        }
    }
}
