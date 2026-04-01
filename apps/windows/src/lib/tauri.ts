import { invoke } from "@tauri-apps/api/core";
import type {
  BatchSession,
  FinalizeQueueItemResponse,
  QueueItem,
  RenameUndoAction
} from "./types";

export async function prepareDroppedFiles(filePaths: string[]) {
  return invoke<QueueItem[]>("prepare_dropped_files", { filePaths });
}

export async function finalizeQueueItem(session: BatchSession, item: QueueItem) {
  return invoke<FinalizeQueueItemResponse>("finalize_queue_item", { session, item });
}

export async function renameReadyItem(session: BatchSession, item: QueueItem) {
  return invoke<QueueItem>("rename_ready_item", { session, item });
}

export async function undoLastRename(action: RenameUndoAction) {
  return invoke<void>("undo_last_rename", { action });
}

export async function exportSessionLog(destinationFolder: string, queue: QueueItem[]) {
  return invoke<void>("export_session_log", { destinationFolder, queue });
}
