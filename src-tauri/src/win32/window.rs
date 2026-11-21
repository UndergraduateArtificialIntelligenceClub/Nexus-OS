use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

pub fn enumerate_windows() -> Vec<String> {
    let mut handles: Vec<String> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut Vec<String> as isize));
    }
    handles
}

unsafe extern "system" fn collect(hwnd: HWND, param: LPARAM) -> BOOL {
    let handles = unsafe { &mut *(param.0 as *mut Vec<String>) };
    handles.push(format!("{:?}", hwnd.0));
    BOOL(1)
}
