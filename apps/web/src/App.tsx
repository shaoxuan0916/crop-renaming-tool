import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  buildPreviewUrl,
  downloadReadyQueueAsZip,
  downloadSingleItem,
  fileToQueueItem,
  finalizeItem,
  rebuildQueueItem,
  removeItemAssets,
  sanitizeFilenameSegment
} from "./lib/workflow";
import { clearBlobStore } from "./lib/db";
import {
  clearQueueStorage,
  EMPTY_SESSION,
  loadPresets,
  loadQueue,
  loadSession,
  savePresets,
  saveQueue,
  saveSession
} from "./lib/storage";
import type { BatchSession, QueueItem } from "./lib/types";

const EMPTY_HINT = "No files yet. Drop images here or use Pick Files.";
const THEME_STORAGE_KEY = "crop-renamer-web:theme";
const MISSING_ASSET_MESSAGE =
  "Stored image data is missing from browser storage. Re-import this file to continue.";

type ThemeMode = "light" | "dark";

export function App() {
  const [session, setSession] = useState<BatchSession>(() => loadSession());
  const [queue, setQueue] = useState<QueueItem[]>(() => loadQueue());
  const [presets, setPresets] = useState<string[]>(() => loadPresets());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [isDropActive, setIsDropActive] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousPreviewUrls = useRef<Record<string, string>>({});
  const dragDepthRef = useRef(0);

  const deferredQueue = useDeferredValue(queue);
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
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function hydratePreviews() {
      const missingPreviewIds = new Set<string>();
      const nextEntries = await Promise.all(
        queue.map(async (item) => {
          const existing = previousPreviewUrls.current[item.id];
          if (existing) {
            return { id: item.id, url: existing, reused: true } as const;
          }
          const previewUrl = await buildPreviewUrl(item);
          if (!previewUrl) {
            missingPreviewIds.add(item.id);
          }
          return { id: item.id, url: previewUrl, reused: false } as const;
        })
      );

      if (cancelled) {
        nextEntries.forEach(({ url, reused }) => {
          if (url && !reused) {
            URL.revokeObjectURL(url);
          }
        });
        return;
      }

      const nextMap = Object.fromEntries(
        nextEntries.flatMap((entry) => (entry.url ? [[entry.id, entry.url] as const] : []))
      );

      for (const [id, url] of Object.entries(previousPreviewUrls.current)) {
        if (!nextMap[id]) {
          URL.revokeObjectURL(url);
        }
      }

      previousPreviewUrls.current = nextMap;
      setPreviewUrls(nextMap);

      if (missingPreviewIds.size > 0) {
        startTransition(() => {
          setQueue((current) =>
            current.map((item) =>
              missingPreviewIds.has(item.id) && item.errorMessage !== MISSING_ASSET_MESSAGE
                ? {
                    ...item,
                    status: "error",
                    errorMessage: MISSING_ASSET_MESSAGE
                  }
                : item
            )
          );
        });
      }
    }

    void hydratePreviews();

    return () => {
      cancelled = true;
    };
  }, [queue]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previousPreviewUrls.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedItemId && queue.some((item) => item.id === selectedItemId)) {
      return;
    }
    setSelectedItemId(queue[0]?.id ?? null);
  }, [queue, selectedItemId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        void handleDownloadAll();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [queue, session.downloadBundleName]);

  async function importFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const imported = await Promise.all(
        files.map((file) => fileToQueueItem(file, session.webpQuality))
      );

      startTransition(() => {
        setQueue((current) => [...imported, ...current]);
        setSelectedItemId(imported[0]?.id ?? null);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleFinalizeSelected() {
    if (!selectedItem) {
      return;
    }

    try {
      const nextItem = finalizeItem(session, selectedItem, queue);
      startTransition(() => {
        setQueue((current) =>
          current.map((item) => (item.id === nextItem.id ? nextItem : item))
        );
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      startTransition(() => {
        setQueue((current) =>
          current.map((item) =>
            item.id === selectedItem.id
              ? { ...item, status: "error", errorMessage: message }
              : item
          )
        );
      });
    }
  }

  async function handleRenameReadyItem() {
    if (!selectedItem) {
      return;
    }

    try {
      const nextItem = finalizeItem(session, selectedItem, queue);
      startTransition(() => {
        setQueue((current) =>
          current.map((item) => (item.id === nextItem.id ? nextItem : item))
        );
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setErrorMessage(message);
      startTransition(() => {
        setQueue((current) =>
          current.map((item) =>
            item.id === selectedItem.id
              ? { ...item, status: "error", errorMessage: message }
              : item
          )
        );
      });
    }
  }

  async function handleRetryItem(item: QueueItem) {
    try {
      const nextItem = await rebuildQueueItem(item, session.webpQuality);
      startTransition(() => {
        setQueue((current) =>
          current.map((entry) => (entry.id === item.id ? nextItem : entry))
        );
        setSelectedItemId(item.id);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleDeleteItem(item: QueueItem) {
    await removeItemAssets(item);
    startTransition(() => {
      setQueue((current) => current.filter((entry) => entry.id !== item.id));
    });
  }

  async function handleResetSession() {
    await Promise.all(queue.map((item) => removeItemAssets(item)));
    await clearBlobStore();
    clearQueueStorage();
    startTransition(() => {
      setSession(EMPTY_SESSION);
      setQueue([]);
      setSelectedItemId(null);
    });
  }

  async function handleDownloadAll() {
    setIsDownloading(true);
    try {
      await downloadReadyQueueAsZip(queue, session.downloadBundleName);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDownloadSelected() {
    if (!selectedItem) {
      return;
    }

    try {
      await downloadSingleItem(selectedItem);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function handleSavePreset() {
    const cleaned = sanitizeFilenameSegment(session.firstToken);
    if (!cleaned) {
      setErrorMessage("Enter a first token before saving a preset.");
      return;
    }

    setSession((current) => ({ ...current, firstToken: cleaned }));
    setPresets((current) => (current.includes(cleaned) ? current : [cleaned, ...current]));
  }

  function handleApplyPreset(preset: string) {
    setSession((current) => ({ ...current, firstToken: preset }));
    setIsPresetModalOpen(false);
  }

  function handleRemovePreset(preset: string) {
    setPresets((current) => current.filter((entry) => entry !== preset));
    if (session.firstToken === preset) {
      setSession((current) => ({ ...current, firstToken: "" }));
    }
  }

  function hasFilePayload(event: React.DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleGlobalDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!hasFilePayload(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleGlobalDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasFilePayload(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDropActive) {
      setIsDropActive(true);
    }
  }

  function handleGlobalDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!hasFilePayload(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDropActive(false);
    }
  }

  function handleGlobalDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasFilePayload(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDropActive(false);
    void importFiles(event.dataTransfer.files);
  }

  const readyCount = queue.filter((item) => item.status === "ready").length;

  return (
    <div
      className="app-shell"
      onDragEnter={handleGlobalDragEnter}
      onDragOver={handleGlobalDragOver}
      onDragLeave={handleGlobalDragLeave}
      onDrop={handleGlobalDrop}
    >
      {isDropActive ? (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <div className="drop-badge">+</div>
            <strong>Drop images anywhere</strong>
            <p>Files will be imported into the queue locally.</p>
          </div>
        </div>
      ) : null}
      <div className="shell">
      <aside className="sidebar">
        <section className="hero">
          <div className="hero-header">
            <div>
              <p className="eyebrow">Web</p>
              <h1>Crop Renamer</h1>
            </div>
            <div className="theme-switch" aria-label="Theme">
              <button
                type="button"
                className={theme === "light" ? "theme-option is-active" : "theme-option"}
                onClick={() => setTheme("light")}
              >
                Light
              </button>
              <button
                type="button"
                className={theme === "dark" ? "theme-option is-active" : "theme-option"}
                onClick={() => setTheme("dark")}
              >
                Dark
              </button>
            </div>
          </div>

          <p className="lede">Rename, convert, and export image crops locally.</p>
        </section>

        <section className="panel control-panel">
          <div className="section-title-row tight">
            <h2>Batch</h2>
            <button
              className="ghost-button"
              onClick={() => void handleResetSession()}
            >
              Reset Session
            </button>
          </div>

          <label className="field">
            <span>First token</span>
            <input
              value={session.firstToken}
              onChange={(event) =>
                setSession((current) => ({ ...current, firstToken: event.target.value }))
              }
              placeholder="2025_math_p1"
            />
          </label>

          <label className="field">
            <span>Zip name</span>
            <input
              value={session.downloadBundleName}
              onChange={(event) =>
                setSession((current) => ({
                  ...current,
                  downloadBundleName: event.target.value
                }))
              }
              placeholder="trial-paper-export"
            />
          </label>

          <div className="button-row compact-grid">
            <button onClick={handleSavePreset}>Save Preset</button>
            <button
              className="ghost-button"
              onClick={() => setIsPresetModalOpen(true)}
              disabled={presets.length === 0}
            >
              Presets
            </button>
            <button
              className="ghost-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Pick Files
            </button>
          </div>

          <input
            ref={fileInputRef}
            hidden
            multiple
            type="file"
            accept="image/*"
            onChange={(event) => {
              if (event.target.files) {
                void importFiles(event.target.files);
                event.target.value = "";
              }
            }}
          />

          <div
            className={`dropzone ${isDropActive ? "is-active" : ""}`}
          >
            <div className="drop-badge">{isImporting ? "..." : "+"}</div>
            <strong>{isImporting ? "Importing..." : "Drop images here"}</strong>
            <p>Everything stays in this browser.</p>
          </div>

          <div className="button-row compact">
            <button
              onClick={() => void handleDownloadAll()}
              disabled={isDownloading || readyCount === 0}
            >
              {isDownloading ? "Preparing Zip..." : "Download Zip"}
            </button>
          </div>
        </section>
      </aside>

      <main className="detail-column">
        {selectedItem ? (
          <>
            <div className="preview-surface">
              {previewUrls[selectedItem.id] ? (
                <div className="preview-frame">
                  <img
                    src={previewUrls[selectedItem.id]}
                    alt={selectedItem.finalName || selectedItem.originalName}
                  />
                </div>
              ) : (
                <div className="empty-preview">Preview loading...</div>
              )}
            </div>

            <section className="detail-surface">
              <div className="detail-panel">
                <div className="section-title-row">
                  <div>
                    <p className="eyebrow">Selected</p>
                    <h2>{selectedItem.originalName}</h2>
                  </div>
                  <button
                    className="ghost-button"
                    onClick={() => void handleDeleteItem(selectedItem)}
                  >
                    Delete
                  </button>
                </div>

                <label className="field">
                  <span>Suffix</span>
                  <input
                    value={selectedItem.suffix}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      startTransition(() => {
                        setQueue((current) =>
                          current.map((item) =>
                            item.id === selectedItem.id
                              ? { ...item, suffix: nextValue }
                              : item
                          )
                        );
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }
                      if (selectedItem.status === "pending" || selectedItem.status === "error") {
                        void handleFinalizeSelected();
                      } else {
                        void handleRenameReadyItem();
                      }
                    }}
                    placeholder="q1_a"
                  />
                </label>

                <div className="meta-grid">
                  <div className="meta-card">
                    <span>Export name</span>
                    <strong>{selectedItem.finalName || "Not finalized yet"}</strong>
                  </div>
                  <div className="meta-card">
                    <span>Status</span>
                    <strong>{formatStatusLabel(selectedItem.status)}</strong>
                  </div>
                </div>

                {selectedItem.errorMessage ? (
                  <div className="error-banner">{selectedItem.errorMessage}</div>
                ) : null}

                <div className="button-row">
                  <button
                    onClick={() => void handleFinalizeSelected()}
                    disabled={selectedItem.status === "ready"}
                  >
                    Finalize
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void handleRenameReadyItem()}
                    disabled={selectedItem.status !== "ready"}
                  >
                    Rename
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void handleRetryItem(selectedItem)}
                  >
                    Retry
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void handleDownloadSelected()}
                    disabled={selectedItem.status !== "ready"}
                  >
                    Download
                  </button>
                </div>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="preview-surface preview-empty">
              <div className="empty-preview">Select a file to preview it here.</div>
            </section>
            <section className="detail-empty">
              <div className="section-title-row">
                <p className="eyebrow">Settings</p>
              </div>
              <h2>Select a file</h2>
              <p>Choose an item from the queue or import new images.</p>
            </section>
          </>
        )}
      </main>

      <aside className="queue-column">
        <section className="panel queue-panel">
          <div className="section-title-row tight">
            <h2>Queue</h2>
            <span className="section-caption">{queue.length} items</span>
          </div>

          <div className="queue-list">
            {deferredQueue.length === 0 ? (
              <div className="empty-state">{EMPTY_HINT}</div>
            ) : (
              deferredQueue.map((item, index) => (
                <button
                  key={item.id}
                  className={`queue-item ${item.id === selectedItemId ? "is-selected" : ""}`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className="queue-index">{index + 1}</div>
                  <div className="queue-copy">
                    <div className="queue-row">
                      <strong>{item.finalName || item.originalName}</strong>
                      <span className={`status-pill status-pill-${item.status}`}>
                        {formatStatusLabel(item.status)}
                      </span>
                    </div>
                    <span className="queue-secondary">
                      {item.finalName ? item.originalName : item.suffix || "No suffix yet"}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      {isPresetModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsPresetModalOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>Presets</h2>
              <button
                className="ghost-button"
                onClick={() => setIsPresetModalOpen(false)}
              >
                Done
              </button>
            </div>

            {presets.length === 0 ? (
              <div className="empty-state">No presets saved yet.</div>
            ) : (
              <div className="preset-list">
                {presets.map((preset) => (
                  <div key={preset} className="preset-row">
                    <button
                      className="preset-button"
                      onClick={() => handleApplyPreset(preset)}
                    >
                      {preset}
                    </button>
                    <button
                      className="ghost-button danger-button"
                      onClick={() => handleRemovePreset(preset)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="toast" role="alert">
          <span>{errorMessage}</span>
          <button
            className="ghost-button"
            onClick={() => setErrorMessage(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatStatusLabel(status: QueueItem["status"]) {
  if (status === "ready") {
    return "Ready";
  }
  if (status === "error") {
    return "Error";
  }
  return "Pending";
}

function loadTheme(): ThemeMode {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}
