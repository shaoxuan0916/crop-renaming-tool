import type { BatchSession, QueueItem } from "./types";

const SESSION_KEY = "crop-renamer-web:session";
const PRESETS_KEY = "crop-renamer-web:presets";
const QUEUE_KEY = "crop-renamer-web:queue";

export const EMPTY_SESSION: BatchSession = {
  firstToken: "",
  downloadBundleName: "crop-renamer-export",
  webpQuality: 0.9
};

export function loadSession(): BatchSession {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return EMPTY_SESSION;
  }

  try {
    return { ...EMPTY_SESSION, ...(JSON.parse(raw) as Partial<BatchSession>) };
  } catch {
    return EMPTY_SESSION;
  }
}

export function saveSession(session: BatchSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadPresets(): string[] {
  const raw = window.localStorage.getItem(PRESETS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: string[]) {
  window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function loadQueue(): QueueItem[] {
  const raw = window.localStorage.getItem(QUEUE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      const normalized = normalizeQueueItem(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearQueueStorage() {
  window.localStorage.removeItem(QUEUE_KEY);
}

function normalizeQueueItem(value: unknown): QueueItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.originalName !== "string" ||
    typeof item.originalType !== "string" ||
    typeof item.originalBlobKey !== "string" ||
    typeof item.webpBlobKey !== "string" ||
    typeof item.createdAt !== "string"
  ) {
    return null;
  }

  const status =
    item.status === "pending" || item.status === "ready" || item.status === "error"
      ? item.status
      : "pending";

  return {
    id: item.id,
    originalName: item.originalName,
    originalType: item.originalType,
    suffix: typeof item.suffix === "string" ? item.suffix : "",
    finalName: typeof item.finalName === "string" ? item.finalName : "",
    status,
    errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
    originalBlobKey: item.originalBlobKey,
    webpBlobKey: item.webpBlobKey,
    createdAt: item.createdAt
  };
}
