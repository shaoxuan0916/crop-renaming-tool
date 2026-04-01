import { deleteDB, openDB } from "idb";

const DB_NAME = "crop-renamer-web";
const DB_VERSION = 1;
const BLOBS_STORE = "blobs";

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(BLOBS_STORE)) {
      db.createObjectStore(BLOBS_STORE);
    }
  }
});

export async function putBlob(key: string, blob: Blob) {
  const db = await dbPromise;
  await db.put(BLOBS_STORE, blob, key);
}

export async function getBlob(key: string) {
  const db = await dbPromise;
  return (await db.get(BLOBS_STORE, key)) as Blob | undefined;
}

export async function deleteBlob(key: string) {
  const db = await dbPromise;
  await db.delete(BLOBS_STORE, key);
}

export async function clearBlobStore() {
  const db = await dbPromise;
  await db.clear(BLOBS_STORE);
}

export async function destroyBlobDatabase() {
  await deleteDB(DB_NAME);
}
