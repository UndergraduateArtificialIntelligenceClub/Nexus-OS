use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::EnumWindows;

pub fn enumerate_windows() -> Vec<String> {
    let mut handles: Vec<String> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), &mut handles as *mut Vec<String> as _);
    }
    handles
}

extern "system" fn collect(hwnd: HWND, param: *mut std::ffi::c_void) -> bool {
    let handles = unsafe { &mut *(param as *mut Vec<String>) };
    handles.push(format!("{:?}", hwnd.0));
    true
}
