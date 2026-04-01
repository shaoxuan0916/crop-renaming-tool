export type WebPMode = "lossy-high";

export type QueueItemStatus = "pending" | "ready" | "error";

export type BatchSession = {
  firstToken: string;
  destinationFolder: string;
  webpMode: WebPMode;
};

export type QueueItem = {
  id: string;
  originalPath: string;
  tempWebPPath: string | null;
  backupOriginalPath: string | null;
  finalPath: string | null;
  previewPath: string;
  suffix: string;
  finalName: string;
  status: QueueItemStatus;
  errorMessage: string | null;
};

export type RenameUndoAction = {
  itemId: string;
  originalPath: string;
  backupOriginalPath: string;
  finalPath: string;
  tempWebPPath: string | null;
};

export type FinalizeQueueItemResponse = {
  item: QueueItem;
  undoAction: RenameUndoAction;
};
