import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  exportSessionLog,
  finalizeQueueItem,
  prepareDroppedFiles,
  renameReadyItem,
  undoLastRename
} from "./lib/tauri";
import { loadPresets, loadQueue, loadSession, savePresets, saveQueue, saveSession } from "./lib/storage";
import type { BatchSession, QueueItem, RenameUndoAction } from "./lib/types";

const EMPTY_SESSION: BatchSession = {
  firstToken: "",
  destinationFolder: "",
  webpMode: "lossy-high"
};

export function App() {
  const [session, setSession] = useState<BatchSession>(() => loadSession());
  const [queue, setQueue] = useState<QueueItem[]>(() => loadQueue());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [presets, setPresets] = useState<string[]>(() => loadPresets());
  const [undoStack, setUndoStack] = useState<RenameUndoAction[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);

  const selectedItem = useMemo(
    () => queue.find((item) => item.id === selectedItemId) ?? null,
    [queue, selectedItemId]
  );

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    savePresets(presets);
  }, [presets]);

  useEffect(() => {
    saveQueue(queue);
  }, [queue]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDropActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setIsDropActive(false);
          return;
        }

        if (event.payload.type === "drop") {
          setIsDropActive(false);
          void handleFilePaths(event.payload.paths);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error) => {
        setErrorMessage(String(error));
      });

    return () => {
      unlisten?.();
    };
  }, [session.destinationFolder]);

  async function chooseDestinationFolder() {
    const selected = await open({
      directory: true,
      multiple: false
    });

    if (typeof selected === "string") {
      setSession((current) => ({ ...current, destinationFolder: selected }));
    }
  }

  async function chooseFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"]
        }
      ]
    });

    const filePaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    await handleFilePaths(filePaths);
  }

  async function handleFilePaths(filePaths: string[]) {
    if (!session.destinationFolder) {
      setErrorMessage("Choose a destination folder before dropping files.");
      return;
    }

    if (filePaths.length === 0) {
      return;
    }

    try {
      const prepared = await prepareDroppedFiles(filePaths);
      setQueue((current) => [...prepared, ...current]);
      setSelectedItemId(prepared[0]?.id ?? null);
    } catch (error) {
      setErrorMessage(String(error));
    }
  }

  async function finalizeSelected() {
    if (!selectedItem) {
      return;
    }

    try {
      const response = await finalizeQueueItem(session, selectedItem);
      setQueue((current) =>
        current.map((item) => (item.id === response.item.id ? response.item : item))
      );
      setUndoStack((current) => [...current, response.undoAction]);
      await persistSessionLog();
    } catch (error) {
      const message = String(error);
      setQueue((current) =>
        current.map((item) =>
          item.id === selectedItem.id
            ? { ...item, status: "error", errorMessage: message }
            : item
        )
      );
      setErrorMessage(message);
    }
  }

  async function renameSelectedReadyItem() {
    if (!selectedItem) {
      return;
    }

    try {
      const updated = await renameReadyItem(session, selectedItem);
      setQueue((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await persistSessionLog();
    } catch (error) {
      const message = String(error);
      setQueue((current) =>
        current.map((item) =>
          item.id === selectedItem.id
            ? { ...item, status: "error", errorMessage: message }
            : item
        )
      );
      setErrorMessage(message);
    }
  }

  async function retryItem(item: QueueItem) {
    setSelectedItemId(item.id);
    if (item.status === "pending" || item.status === "error") {
      await finalizeSelected();
      return;
    }
    if (item.status === "ready") {
      await renameSelectedReadyItem();
    }
  }

  async function performUndo() {
    const action = undoStack.at(-1);
    if (!action) {
      return;
    }

    try {
      await undoLastRename(action);
      setUndoStack((current) => current.slice(0, -1));
      setQueue((current) => current.filter((item) => item.id !== action.itemId));
      if (selectedItemId === action.itemId) {
        setSelectedItemId(null);
      }
      await persistSessionLog();
    } catch (error) {
      setErrorMessage(String(error));
    }
  }

  async function persistSessionLog() {
    if (!session.destinationFolder) {
      return;
    }
    await exportSessionLog(session.destinationFolder, queue);
  }

  function savePreset() {
    const cleaned = sanitizeToken(session.firstToken);
    if (!cleaned) {
      setErrorMessage("Enter a first token before saving a preset.");
      return;
    }

    setSession((current) => ({ ...current, firstToken: cleaned }));
    setPresets((current) => (current.includes(cleaned) ? current : [cleaned, ...current]));
  }

  function applyPreset(preset: string) {
    setSession((current) => ({ ...current, firstToken: preset }));
    setIsPresetModalOpen(false);
  }

  function removePreset(preset: string) {
    setPresets((current) => current.filter((value) => value !== preset));
    if (session.firstToken === preset) {
      setSession((current) => ({ ...current, firstToken: "" }));
    }
  }

  function updateSelectedSuffix(nextSuffix: string) {
    if (!selectedItemId) {
      return;
    }

    setQueue((current) =>
      current.map((item) => (item.id === selectedItemId ? { ...item, suffix: nextSuffix } : item))
    );
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void performUndo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoStack, selectedItemId, queue]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <section className="card">
          <div className="section-header">
            <h1>Batch Setup</h1>
            <button className="ghost-button" onClick={performUndo} disabled={undoStack.length === 0}>
              Undo
            </button>
          </div>

          <label className="field">
            <span>First token</span>
            <input
              value={session.firstToken}
              onChange={(event) =>
                setSession((current) => ({ ...current, firstToken: event.target.value }))
              }
              placeholder="e.g. 2025_math_p1"
            />
          </label>

          <label className="field">
            <span>Destination folder</span>
            <div className="field-row">
              <input
                value={session.destinationFolder}
                onChange={(event) =>
                  setSession((current) => ({
                    ...current,
                    destinationFolder: event.target.value
                  }))
                }
                placeholder="Choose a destination folder"
              />
              <button onClick={() => void chooseDestinationFolder()}>Choose</button>
            </div>
          </label>

          <div className="button-row">
            <button onClick={savePreset}>Save Preset</button>
            <button onClick={() => setIsPresetModalOpen(true)} disabled={presets.length === 0}>
              Manage Presets
            </button>
            <button onClick={() => void chooseFiles()}>Pick Files</button>
          </div>

          <div className={`dropzone ${isDropActive ? "is-active" : ""}`}>
            <div className="dropzone-icon">+</div>
            <strong>Drop cropped images here</strong>
            <p>Tauri window drag-drop is used so the app receives real file paths on Windows.</p>
          </div>
        </section>

        <section className="card queue-card">
          <div className="section-header">
            <h2>Queue</h2>
            <span>{queue.length} items</span>
          </div>

          <div className="queue-list">
            {queue.length === 0 ? (
              <div className="empty-state">No items yet.</div>
            ) : (
              queue.map((item) => (
                <button
                  key={item.id}
                  className={`queue-item ${selectedItemId === item.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className="queue-title">{item.finalName || fileNameFromPath(item.originalPath)}</div>
                  <div className={`queue-status status-${item.status}`}>{item.status}</div>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="detail">
        {selectedItem ? (
          <section className="card detail-card">
            <div className="preview-frame">
              <img
                alt={selectedItem.finalName || selectedItem.originalPath}
                src={pathToFileUrl(selectedItem.previewPath)}
              />
            </div>

            <div className="detail-body">
              <h2>{fileNameFromPath(selectedItem.originalPath)}</h2>

              <label className="field">
                <span>Suffix</span>
                <input
                  value={selectedItem.suffix}
                  onChange={(event) => updateSelectedSuffix(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }
                    if (selectedItem.status === "pending") {
                      void finalizeSelected();
                    } else if (selectedItem.status === "ready") {
                      void renameSelectedReadyItem();
                    }
                  }}
                  placeholder="e.g. q1_a"
                />
              </label>

              <div className="meta-grid">
                <div>
                  <span>Final name</span>
                  <strong>{selectedItem.finalName || "Not finalized yet"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{selectedItem.status}</strong>
                </div>
              </div>

              {selectedItem.errorMessage ? (
                <div className="error-banner">{selectedItem.errorMessage}</div>
              ) : null}

              <div className="button-row">
                <button
                  onClick={() => void finalizeSelected()}
                  disabled={selectedItem.status === "ready"}
                >
                  Finalize
                </button>
                <button
                  onClick={() => void renameSelectedReadyItem()}
                  disabled={selectedItem.status !== "ready"}
                >
                  Rename
                </button>
                <button onClick={() => void retryItem(selectedItem)}>Retry</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="card empty-detail">
            <h2>Drop a cropped image to start</h2>
            <p>The selected queue item will show its preview and suffix editor here.</p>
          </section>
        )}
      </main>

      {errorMessage ? (
        <div className="modal-backdrop" onClick={() => setErrorMessage(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3>Workflow Error</h3>
            <p>{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)}>OK</button>
          </div>
        </div>
      ) : null}

      {isPresetModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsPresetModalOpen(false)}>
          <div className="modal preset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h3>User Presets</h3>
              <button className="ghost-button" onClick={() => setIsPresetModalOpen(false)}>
                Done
              </button>
            </div>

            {presets.length === 0 ? (
              <div className="empty-state">No presets saved.</div>
            ) : (
              <div className="preset-list">
                {presets.map((preset) => (
                  <div key={preset} className="preset-row">
                    <button className="preset-name" onClick={() => applyPreset(preset)}>
                      {preset}
                    </button>
                    <button className="danger-button" onClick={() => removePreset(preset)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sanitizeToken(value: string) {
  return value.replace(/\s+/g, "_").trim();
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}

function pathToFileUrl(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return `tauri://localhost/${normalized.startsWith("/") ? normalized.slice(1) : normalized}`;
}
