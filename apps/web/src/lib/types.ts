export type QueueItemStatus = "pending" | "ready" | "error";

export type BatchSession = {
  firstToken: string;
  downloadBundleName: string;
  webpQuality: number;
};

export type QueueItem = {
  id: string;
  originalName: string;
  originalType: string;
  suffix: string;
  finalName: string;
  status: QueueItemStatus;
  errorMessage: string | null;
  originalBlobKey: string;
  webpBlobKey: string;
  createdAt: string;
};

export type QueueSnapshot = {
  session: BatchSession;
  presets: string[];
  queue: QueueItem[];
};
