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

const EMPTY_HINT =
  "No items yet. Drop cropped images here or use the file picker to build your browser-local queue.";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousPreviewUrls = useRef<Record<string, string>>({});

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
    let cancelled = false;

    async function hydratePreviews() {
      const nextEntries = await Promise.all(
        queue.map(async (item) => {
          const existing = previousPreviewUrls.current[item.id];
          if (existing) {
            return [item.id, existing] as const;
          }
          const previewUrl = await buildPreviewUrl(item);
          return [item.id, previewUrl] as const;
        })
      );

      if (cancelled) {
        nextEntries.forEach(([, url]) => {
          if (url) {
            URL.revokeObjectURL(url);
          }
        });
        return;
      }

      const nextMap = Object.fromEntries(
        nextEntries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
      );

      for (const [id, url] of Object.entries(previousPreviewUrls.current)) {
        if (!nextMap[id]) {
          URL.revokeObjectURL(url);
        }
      }

      previousPreviewUrls.current = nextMap;
      setPreviewUrls(nextMap);
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

  async function handleClearAll() {
    await Promise.all(queue.map((item) => removeItemAssets(item)));
    await clearBlobStore();
    clearQueueStorage();
    startTransition(() => {
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

  const readyCount = queue.filter((item) => item.status === "ready").length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <section className="panel poster">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Browser Local</p>
              <h1>Crop Renamer Web</h1>
            </div>
            <button
              className="secondary-button"
              onClick={() => setSession(EMPTY_SESSION)}
            >
              Reset Session
            </button>
          </div>

          <p className="lede">
            Drop cropped images, convert them to WebP in-browser, finalize names,
            and download everything as a ZIP to your browser downloads.
          </p>
        </section>

        <section className="panel">
          <div className="section-title-row">
            <h2>Batch Setup</h2>
            <span>{readyCount} ready</span>
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
            <span>Download bundle name</span>
            <input
              value={session.downloadBundleName}
              onChange={(event) =>
                setSession((current) => ({
                  ...current,
                  downloadBundleName: event.target.value
                }))
              }
              placeholder="e.g. trial-paper-export"
            />
          </label>

          <div className="button-row">
            <button onClick={handleSavePreset}>Save Preset</button>
            <button
              className="secondary-button"
              onClick={() => setIsPresetModalOpen(true)}
              disabled={presets.length === 0}
            >
              Manage Presets
            </button>
            <button
              className="secondary-button"
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
            onDragOver={(event) => {
              event.preventDefault();
              setIsDropActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDropActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDropActive(false);
              void importFiles(event.dataTransfer.files);
            }}
          >
            <div className="drop-badge">{isImporting ? "..." : "WEBP"}</div>
            <strong>Drop cropped images here</strong>
            <p>
              Files are stored locally in your browser. No external storage is used.
            </p>
          </div>

          <div className="button-row compact">
            <button
              className="secondary-button"
              onClick={() => void handleDownloadAll()}
              disabled={isDownloading || readyCount === 0}
            >
              {isDownloading ? "Preparing ZIP..." : "Download All (.zip)"}
            </button>
            <button
              className="secondary-button"
              onClick={() => void handleClearAll()}
              disabled={queue.length === 0}
            >
              Clear Queue
            </button>
          </div>
        </section>

        <section className="panel queue-panel">
          <div className="section-title-row">
            <h2>Queue</h2>
            <span>{queue.length} items</span>
          </div>

          <div className="queue-list">
            {deferredQueue.length === 0 ? (
              <div className="empty-state">{EMPTY_HINT}</div>
            ) : (
              deferredQueue.map((item) => (
                <button
                  key={item.id}
                  className={`queue-item ${item.id === selectedItemId ? "is-selected" : ""}`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <div className="queue-copy">
                    <strong>{item.finalName || item.originalName}</strong>
                    <span>{item.status}</span>
                  </div>
                  <div className={`status-dot status-${item.status}`} />
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="detail">
        {selectedItem ? (
          <section className="detail-surface">
            <div className="preview-surface">
              {previewUrls[selectedItem.id] ? (
                <img
                  src={previewUrls[selectedItem.id]}
                  alt={selectedItem.finalName || selectedItem.originalName}
                />
              ) : (
                <div className="empty-preview">Preview loading…</div>
              )}
            </div>

            <div className="detail-panel">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Selected Item</p>
                  <h2>{selectedItem.originalName}</h2>
                </div>
                <button
                  className="secondary-button"
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
                  placeholder="e.g. q1_a"
                />
              </label>

              <div className="meta-grid">
                <div className="meta-card">
                  <span>Final name</span>
                  <strong>{selectedItem.finalName || "Not finalized yet"}</strong>
                </div>
                <div className="meta-card">
                  <span>Status</span>
                  <strong>{selectedItem.status}</strong>
                </div>
              </div>

              {selectedItem.errorMessage ? (
                <div className="error-banner">{selectedItem.errorMessage}</div>
              ) : null}

              <div className="button-row">
                <button
                  onClick={() => void handleFinalizeSelected()}
                  disabled={!session.firstToken.trim()}
                >
                  Finalize
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void handleRenameReadyItem()}
                  disabled={selectedItem.status !== "ready"}
                >
                  Rename
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void handleRetryItem(selectedItem)}
                >
                  Retry
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void handleDownloadSelected()}
                  disabled={selectedItem.status !== "ready"}
                >
                  Download Item
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="detail-empty">
            <p className="eyebrow">Workspace</p>
            <h2>Choose or drop an image to start</h2>
            <p>
              The browser version keeps everything locally and exports finalized
              `.webp` files as a ZIP into your browser downloads.
            </p>
          </section>
        )}
      </main>

      {isPresetModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsPresetModalOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>User Presets</h2>
              <button
                className="secondary-button"
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
                      className="danger-button"
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
            className="secondary-button"
            onClick={() => setErrorMessage(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
