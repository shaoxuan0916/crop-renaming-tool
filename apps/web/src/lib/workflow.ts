import JSZip from "jszip";
import { deleteBlob, getBlob, putBlob } from "./db";
import type { BatchSession, QueueItem } from "./types";

export async function fileToQueueItem(file: File, quality: number): Promise<QueueItem> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not a supported image.`);
  }

  return blobToQueueItem(file, file.name, file.type, quality);
}

export async function blobToQueueItem(
  blob: Blob,
  originalName: string,
  originalType: string,
  quality: number
): Promise<QueueItem> {
  const id = crypto.randomUUID();
  const originalBlobKey = `original:${id}`;
  const webpBlobKey = `webp:${id}`;

  await putBlob(originalBlobKey, blob);

  try {
    const webpBlob = await convertBlobToWebp(blob, quality);
    await putBlob(webpBlobKey, webpBlob);
  } catch (error) {
    await Promise.allSettled([
      deleteBlob(originalBlobKey),
      deleteBlob(webpBlobKey)
    ]);
    throw error;
  }

  return {
    id,
    originalName,
    originalType,
    suffix: "",
    finalName: "",
    status: "pending",
    errorMessage: null,
    originalBlobKey,
    webpBlobKey,
    createdAt: new Date().toISOString()
  };
}

export async function rebuildQueueItem(item: QueueItem, quality: number): Promise<QueueItem> {
  const originalBlob = await getBlob(item.originalBlobKey);
  if (!originalBlob) {
    throw new Error("The original image is no longer available in browser storage.");
  }

  const webpBlob = await convertBlobToWebp(originalBlob, quality);
  await putBlob(item.webpBlobKey, webpBlob);

  return {
    ...item,
    status: item.finalName ? "ready" : "pending",
    errorMessage: null
  };
}

export function finalizeItem(
  session: BatchSession,
  item: QueueItem,
  queue: QueueItem[]
): QueueItem {
  const firstToken = sanitizeFilenameSegment(session.firstToken);
  const suffix = sanitizeFilenameSegment(item.suffix);
  const baseFilename = buildBaseFilename(firstToken, suffix);
  if (!baseFilename) {
    throw new Error("Enter a suffix or first token before finalizing files.");
  }

  const finalName = `${baseFilename}.webp`;

  const collision = queue.some(
    (entry) => entry.id !== item.id && entry.finalName.toLowerCase() === finalName.toLowerCase()
  );
  if (collision) {
    throw new Error(`A file named ${finalName} already exists in the queue.`);
  }

  return {
    ...item,
    suffix,
    finalName,
    status: "ready",
    errorMessage: null
  };
}

export async function removeItemAssets(item: QueueItem) {
  await Promise.all([deleteBlob(item.originalBlobKey), deleteBlob(item.webpBlobKey)]);
}

export async function buildPreviewUrl(item: QueueItem) {
  const blob = await getBlob(item.webpBlobKey);
  if (!blob) {
    return null;
  }
  return URL.createObjectURL(blob);
}

export async function downloadSingleItem(item: QueueItem) {
  if (!item.finalName) {
    throw new Error("Finalize the item before downloading it.");
  }

  const blob = await getBlob(item.webpBlobKey);
  if (!blob) {
    throw new Error("The converted image is missing from browser storage.");
  }

  triggerDownload(blob, item.finalName);
}

export async function downloadReadyQueueAsZip(queue: QueueItem[], bundleName: string) {
  const readyItems = queue.filter((item) => item.status === "ready" && item.finalName);
  if (readyItems.length === 0) {
    throw new Error("There are no finalized items to download.");
  }

  const zip = new JSZip();

  for (const item of readyItems) {
    const blob = await getBlob(item.webpBlobKey);
    if (!blob) {
      throw new Error(`The converted image for ${item.originalName} is missing.`);
    }
    zip.file(item.finalName, blob);
  }

  const archive = await zip.generateAsync({ type: "blob" });
  triggerDownload(archive, `${sanitizeFilenameSegment(bundleName) || "crop-renamer-export"}.zip`);
}

export function sanitizeFilenameSegment(value: string) {
  return value
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\s]+|[_.\s]+$/g, "");
}

function buildBaseFilename(firstToken: string, suffix: string) {
  if (!suffix) {
    return firstToken;
  }
  if (!firstToken) {
    return suffix;
  }
  return `${firstToken}_${suffix}`;
}

async function convertBlobToWebp(blob: Blob, quality: number) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Unable to prepare an in-browser canvas for conversion.");
      }
      context.drawImage(bitmap, 0, 0);
      return await canvas.convertToBlob({ type: "image/webp", quality });
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to prepare an in-browser canvas for conversion.");
    }
    context.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error("The browser could not convert the image to WebP."));
        },
        "image/webp",
        quality
      );
    });
  } finally {
    bitmap.close();
  }
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
