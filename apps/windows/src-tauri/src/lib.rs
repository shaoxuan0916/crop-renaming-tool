mod workflow;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;
use workflow::{
    build_final_filename, cleanup_item, convert_image_to_webp, ensure_directory, move_replacing_existing,
    sanitize_filename_segment, WorkflowError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueItemStatus {
    Pending,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSession {
    pub first_token: String,
    pub destination_folder: String,
    pub webp_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub original_path: String,
    pub temp_webp_path: Option<String>,
    pub backup_original_path: Option<String>,
    pub final_path: Option<String>,
    pub preview_path: String,
    pub suffix: String,
    pub final_name: String,
    pub status: QueueItemStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameUndoAction {
    pub item_id: String,
    pub original_path: String,
    pub backup_original_path: String,
    pub final_path: String,
    pub temp_webp_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeQueueItemResponse {
    pub item: QueueItem,
    pub undo_action: RenameUndoAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogEntry {
    pub id: String,
    pub final_name: String,
    pub final_path: Option<String>,
    pub original_path: String,
    pub status: QueueItemStatus,
}

#[tauri::command]
fn prepare_dropped_files(app: AppHandle, file_paths: Vec<String>) -> Result<Vec<QueueItem>, String> {
    file_paths
        .into_iter()
        .map(|path| prepare_dropped_file(&app, PathBuf::from(path)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn finalize_queue_item(
    item: QueueItem,
    session: BatchSession,
) -> Result<FinalizeQueueItemResponse, String> {
    finalize_item(item, session).map_err(|error| error.to_string())
}

#[tauri::command]
fn rename_ready_item(item: QueueItem, session: BatchSession) -> Result<QueueItem, String> {
    rename_item(item, session).map_err(|error| error.to_string())
}

#[tauri::command]
fn undo_last_rename(action: RenameUndoAction) -> Result<(), String> {
    undo_action(action).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_session_log(destination_folder: String, queue: Vec<QueueItem>) -> Result<(), String> {
    let destination = PathBuf::from(destination_folder);
    ensure_directory(&destination).map_err(|error| error.to_string())?;

    let log_entries = queue
        .into_iter()
        .map(|item| SessionLogEntry {
            id: item.id,
            final_name: item.final_name,
            final_path: item.final_path,
            original_path: item.original_path,
            status: item.status,
        })
        .collect::<Vec<_>>();

    let payload = serde_json::to_string_pretty(&log_entries).map_err(|error| error.to_string())?;
    let log_path = destination.join("crop-session-log.json");
    fs::write(log_path, payload).map_err(|error| error.to_string())
}

fn prepare_dropped_file(app: &AppHandle, file_path: PathBuf) -> Result<QueueItem, WorkflowError> {
    if !file_path.exists() {
        return Err(WorkflowError::FileNotFound);
    }

    let item_id = Uuid::new_v4().to_string();
    let temp_directory = std::env::temp_dir().join("crop-renamer").join(&item_id);
    ensure_directory(&temp_directory)?;

    let base_name = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("cropped-image");

    let temp_webp_path = temp_directory.join(format!("{base_name}.webp"));
    convert_image_to_webp(app, &file_path, &temp_webp_path)?;

    Ok(QueueItem {
        id: item_id,
        original_path: file_path.to_string_lossy().to_string(),
        temp_webp_path: Some(temp_webp_path.to_string_lossy().to_string()),
        backup_original_path: None,
        final_path: None,
        preview_path: temp_webp_path.to_string_lossy().to_string(),
        suffix: String::new(),
        final_name: String::new(),
        status: QueueItemStatus::Pending,
        error_message: None,
    })
}

fn finalize_item(item: QueueItem, session: BatchSession) -> Result<FinalizeQueueItemResponse, WorkflowError> {
    let temp_webp_path = item
        .temp_webp_path
        .clone()
        .ok_or(WorkflowError::MissingPreparedImage)?;
    let temp_webp = PathBuf::from(temp_webp_path);
    if !temp_webp.exists() {
        return Err(WorkflowError::FileNotFound);
    }

    let destination_folder = PathBuf::from(&session.destination_folder);
    ensure_directory(&destination_folder)?;

    let first_token = sanitize_filename_segment(&session.first_token);
    let suffix = sanitize_filename_segment(&item.suffix);
    let final_name = build_final_filename(&first_token, &suffix);
    if final_name.is_empty() {
        return Err(WorkflowError::MissingFilenameTokens);
    }
    let final_path = destination_folder.join(format!("{final_name}.webp"));
    if final_path.exists() {
        return Err(WorkflowError::FilenameCollision(final_path.display().to_string()));
    }

    let original_path = PathBuf::from(&item.original_path);
    let backup_directory = std::env::temp_dir()
        .join("crop-renamer-backups")
        .join(&item.id);
    ensure_directory(&backup_directory)?;
    let backup_path = backup_directory.join(
        original_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("source-image"),
    );

    move_replacing_existing(&original_path, &backup_path)?;
    if let Err(error) = move_replacing_existing(&temp_webp, &final_path) {
        let _ = move_replacing_existing(&backup_path, &original_path);
        return Err(error);
    }

    let mut updated = item.clone();
    updated.suffix = suffix;
    updated.final_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    updated.final_path = Some(final_path.to_string_lossy().to_string());
    updated.preview_path = final_path.to_string_lossy().to_string();
    updated.backup_original_path = Some(backup_path.to_string_lossy().to_string());
    updated.temp_webp_path = None;
    updated.status = QueueItemStatus::Ready;
    updated.error_message = None;

    Ok(FinalizeQueueItemResponse {
        item: updated,
        undo_action: RenameUndoAction {
            item_id: item.id,
            original_path: original_path.to_string_lossy().to_string(),
            backup_original_path: backup_path.to_string_lossy().to_string(),
            final_path: final_path.to_string_lossy().to_string(),
            temp_webp_path: None,
        },
    })
}

fn rename_item(item: QueueItem, session: BatchSession) -> Result<QueueItem, WorkflowError> {
    let current_final = item
        .final_path
        .clone()
        .map(PathBuf::from)
        .ok_or(WorkflowError::MissingFinalPath)?;

    let first_token = sanitize_filename_segment(&session.first_token);
    let suffix = sanitize_filename_segment(&item.suffix);
    let new_name = build_final_filename(&first_token, &suffix);
    if new_name.is_empty() {
        return Err(WorkflowError::MissingFilenameTokens);
    }
    let new_final = current_final.with_file_name(format!("{new_name}.webp"));

    if current_final != new_final && new_final.exists() {
        return Err(WorkflowError::FilenameCollision(new_final.display().to_string()));
    }

    if current_final != new_final {
        move_replacing_existing(&current_final, &new_final)?;
    }

    let mut updated = item;
    updated.suffix = suffix;
    updated.final_name = new_final
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    updated.final_path = Some(new_final.to_string_lossy().to_string());
    updated.preview_path = new_final.to_string_lossy().to_string();
    updated.status = QueueItemStatus::Ready;
    updated.error_message = None;
    Ok(updated)
}

fn undo_action(action: RenameUndoAction) -> Result<(), WorkflowError> {
    let original = PathBuf::from(action.original_path);
    let backup = PathBuf::from(action.backup_original_path);
    let final_path = PathBuf::from(action.final_path);

    if final_path.exists() {
        fs::remove_file(&final_path).map_err(WorkflowError::Io)?;
    }

    if backup.exists() {
        move_replacing_existing(&backup, &original)?;
    }

    cleanup_item(&action.temp_webp_path, Some(&backup));
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            prepare_dropped_files,
            finalize_queue_item,
            rename_ready_item,
            undo_last_rename,
            export_session_log
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
