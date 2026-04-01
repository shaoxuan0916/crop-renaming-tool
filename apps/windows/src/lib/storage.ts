import type { BatchSession, QueueItem } from "./types";

const SESSION_KEY = "crop-renamer:session";
const PRESETS_KEY = "crop-renamer:presets";
const QUEUE_KEY = "crop-renamer:queue";

export function loadSession(): BatchSession {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return {
      firstToken: "",
      destinationFolder: "",
      webpMode: "lossy-high"
    };
  }

  try {
    return JSON.parse(raw) as BatchSession;
  } catch {
    return {
      firstToken: "",
      destinationFolder: "",
      webpMode: "lossy-high"
    };
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
    return JSON.parse(raw) as string[];
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
    return JSON.parse(raw) as QueueItem[];
  } catch {
    return [];
  }
}

export function saveQueue(queue: QueueItem[]) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}
