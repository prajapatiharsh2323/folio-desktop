//! Taskbar jump list (09 §3): "Open Folio" / "Import file…" user tasks.
//!
//! Built once at startup through the COM `ICustomDestinationList` API. The
//! tasks launch `Folio.exe` with (or without) `--import`, which the argv
//! parser in [`crate::open_files`] already routes into the pending launch
//! queue — the jump list is just another entry point into the same pipeline.
//!
//! Failure is silent and non-fatal: a missing jump list (restricted shell,
//! older Windows, no shell access in tests) must never block app launch.

/// A jump-list user task. `args` are appended after the running exe's path.
pub struct JumpListTask {
    pub title: &'static str,
    pub args: Option<&'static str>,
}

/// The tasks Folio pins to its taskbar icon when it is pinned.
pub fn tasks() -> Vec<JumpListTask> {
    vec![
        JumpListTask {
            title: "Open Folio",
            args: None,
        },
        JumpListTask {
            title: "Import file…",
            args: Some("--import"),
        },
    ]
}

/// Build the jump list. Non-Windows targets are a no-op.
pub fn install() {
    #[cfg(windows)]
    imp::install_impl();
}

#[cfg(windows)]
mod imp {
    use super::JumpListTask;
    use std::thread;
    use windows::core::{IUnknown, Interface, GUID, HSTRING, PWSTR};
    use windows::Win32::Foundation::{E_FAIL, PROPERTYKEY};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{ICustomDestinationList, IShellLinkW};

    // windows 0.62 no longer generates coclass helpers that expose CLSIDs, and
    // the C++ names here (CLSID_ShellLink, CLSID_EnumerableObjectCollection,
    // CLSID_DestinationList) are not shipped as constants either, so the
    // well-known GUIDs are pinned locally. Values verified against the
    // windows-sys 0.61 registry sources and the Windows SDK documentation.
    const CLSID_SHELL_LINK: GUID = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
    const CLSID_ENUMERABLE_OBJECT_COLLECTION: GUID =
        GUID::from_u128(0x2d3468c1_36a7_43b6_ac24_d3f02fd9607a);
    const CLSID_DESTINATION_LIST: GUID = GUID::from_u128(0x77f10cf0_3db5_4966_b520_b7c54fd35ed6);

    pub fn install_impl() {
        // The jump list talks to the shell over STA; run it on its own thread
        // so Tauri's main-thread apartment is never touched.
        thread::Builder::new()
            .name("folio-jumplist".into())
            .spawn(|| {
                let _ = build_jump_list();
            })
            .ok(); // a failed spawn only costs the jump list, never the app
    }

    fn build_jump_list() -> windows::core::Result<()> {
        unsafe {
            // S_OK and S_FALSE (already initialized on this thread) both count;
            // ok() checks the severity bit, which accepts both.
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let result = pin_tasks();
            CoUninitialize();
            result
        }
    }

    unsafe fn pin_tasks() -> windows::core::Result<()> {
        unsafe {
            let list: ICustomDestinationList = CoCreateInstance(
                &CLSID_DESTINATION_LIST,
                None::<&IUnknown>,
                CLSCTX_INPROC_SERVER,
            )?;

            // BeginList is required before any task can be added, even though
            // Folio keeps its default removal behaviour.
            let mut min_slots: u32 = 0;
            let removed: IObjectArray = list.BeginList(&mut min_slots)?;
            drop(removed);

            let collection: IObjectCollection = CoCreateInstance(
                &CLSID_ENUMERABLE_OBJECT_COLLECTION,
                None::<&IUnknown>,
                CLSCTX_INPROC_SERVER,
            )?;

            for task in super::tasks() {
                let link = link_for(task)?;
                collection.AddObject(&link)?;
            }

            let tasks: IObjectArray = collection.cast()?;
            list.AddUserTasks(&tasks)?;
            list.CommitList()
        }
    }

    /// A shell link for one task: `Folio.exe [args]`, icon = the exe itself.
    unsafe fn link_for(task: JumpListTask) -> windows::core::Result<IShellLinkW> {
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&CLSID_SHELL_LINK, None::<&IUnknown>, CLSCTX_INPROC_SERVER)?;

            let exe = std::env::current_exe().map_err(|_| E_FAIL)?;
            let exe_str = HSTRING::from(exe.as_os_str());
            link.SetPath(&exe_str)?;
            link.SetIconLocation(&exe_str, 0)?;

            if let Some(args) = task.args {
                link.SetArguments(&HSTRING::from(args))?;
            }

            // Jump-list tasks need PKEY_Title in the link's property store,
            // otherwise the taskbar shows the file name, not the label. The
            // UTF-16 buffer behind the PROPVARIANT pointer must stay alive for
            // the whole SetValue/Commit exchange, which it does: it lives to
            // the end of this function.
            let store: IPropertyStore = link.cast()?;
            let mut wide: Vec<u16> = task
                .title
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let mut propvar = PROPVARIANT::default();
            // `PROPVARIANT`'s middle field is a `ManuallyDrop` inside a union,
            // so the write must dereference it explicitly (rustc's
            // union-DerefMut lint rejects the implicit form).
            let fields = core::ops::DerefMut::deref_mut(&mut propvar.Anonymous.Anonymous);
            fields.vt = VT_LPWSTR;
            fields.Anonymous.pwszVal = PWSTR(wide.as_mut_ptr());
            store.SetValue(&PKEY_Title as *const PROPERTYKEY, &propvar)?;
            store.Commit()?;
            drop(propvar); // no PropVariantClear: the buffer was caller-owned

            Ok(link)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jump_list_tasks_are_open_and_import() {
        let tasks = tasks();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "Open Folio");
        assert!(tasks[0].args.is_none());
        assert_eq!(tasks[1].title, "Import file…");
        assert_eq!(tasks[1].args.as_deref(), Some("--import"));
    }

    #[test]
    fn import_task_args_flow_through_arg_parser() {
        // The jump list is only an argv producer; whatever it emits must be
        // understood by the same parser that handles Open-with and
        // single-instance relaunches.
        for task in tasks() {
            let argv = std::iter::once("Folio.exe".to_string()).chain(
                task.args
                    .unwrap_or_default()
                    .split_whitespace()
                    .map(str::to_string),
            );
            let req = crate::open_files::parse_args(argv);
            assert_eq!(req.import_requested, task.args.is_some(), "{}", task.title);
            assert!(req.files.is_empty(), "{}", task.title);
        }
    }
}
