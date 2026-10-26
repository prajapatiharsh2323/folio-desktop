const ES_CONTINUOUS: u32 = 0x80000000;
const ES_DISPLAY_REQUIRED: u32 = 0x00000002;

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(esflags: u32) -> u32;
}

#[tauri::command]
pub fn prevent_display_sleep(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        if enable {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enable;
    }
    Ok(())
}
