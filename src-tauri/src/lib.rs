mod adapters;
mod bridge;
mod session_checkpoint;
mod settings;
mod snapshots;
mod webviews;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            webviews::provider_open,
            webviews::provider_close,
            webviews::provider_show,
            webviews::provider_hide,
            webviews::provider_set_bounds,
            webviews::provider_eval,
            webviews::provider_eval_with_callback,
            webviews::provider_open_login,
            webviews::provider_open_login_external,
            webviews::provider_reload,
            webviews::provider_new_session,
            webviews::connections_get,
            webviews::dev_log,
            adapters::adapter_push,
            adapters::report_broken,
            settings::settings_get,
            settings::settings_set,
            settings::export_markdown,
            settings::open_external_url,
            snapshots::snapshot_save,
            snapshots::snapshot_list,
            snapshots::snapshot_load,
            snapshots::snapshot_delete,
            session_checkpoint::session_checkpoint_save,
            session_checkpoint::session_checkpoint_load,
            session_checkpoint::session_checkpoint_clear
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
