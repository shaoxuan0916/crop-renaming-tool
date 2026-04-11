import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  type PDFDocumentProxy,
  type RenderTask
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  blobToQueueItem,
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
const MIN_CROP_SIZE = 12;

type ThemeMode = "light" | "dark";
type Point = { x: number; y: number };
type CropRect = { x: number; y: number; width: number; height: number };

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
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfName, setPdfName] = useState("");
  const [pdfPageNumber, setPdfPageNumber] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [isPdfWorkspaceVisible, setIsPdfWorkspaceVisible] = useState(false);
  const [isPdfRendering, setIsPdfRendering] = useState(false);
  const [pdfErrorMessage, setPdfErrorMessage] = useState<string | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [isCropDragging, setIsCropDragging] = useState(false);
  const [isSuffixPopupOpen, setIsSuffixPopupOpen] = useState(false);
  const [suffixDraft, setSuffixDraft] = useState("");
  const [pdfCropCount, setPdfCropCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pdfViewportRef = useRef<HTMLDivElement | null>(null);
  const cropStartRef = useRef<Point | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const suffixInputRef = useRef<HTMLInputElement | null>(null);
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
    return () => {
      renderTaskRef.current?.cancel();
      void pdfDocument?.destroy();
    };
  }, [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument || !isPdfWorkspaceVisible) {
      return;
    }

    const activeDocument = pdfDocument;
    const activeCanvas = pdfCanvasRef.current;
    const viewportElement = pdfSurfaceRef.current;
    const context = activeCanvas?.getContext("2d");
    if (!activeCanvas || !viewportElement || !context) {
      return;
    }
    const renderCanvas = activeCanvas;
    const renderViewportElement = viewportElement;
    const renderContext = context;

    let cancelled = false;
    setIsPdfRendering(true);
    setPdfErrorMessage(null);
    clearCropSelection();

    async function renderPdfPage() {
      renderTaskRef.current?.cancel();

      try {
        const page = await activeDocument.getPage(pdfPageNumber);
        if (cancelled) {
          page.cleanup();
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max(320, renderViewportElement.clientWidth - 32);
        const availableHeight = Math.max(360, renderViewportElement.clientHeight - 96);
        const scale = Math.min(
          2.25,
          Math.max(
            0.6,
            Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)
          )
        );
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;

        renderCanvas.width = Math.floor(viewport.width * outputScale);
        renderCanvas.height = Math.floor(viewport.height * outputScale);
        renderCanvas.style.width = `${Math.floor(viewport.width)}px`;
        renderCanvas.style.height = `${Math.floor(viewport.height)}px`;

        const renderTask = page.render({
          canvas: null,
          canvasContext: renderContext,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          background: "white"
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (!cancelled) {
          page.cleanup();
          setIsPdfRendering(false);
        }
      } catch (error) {
        if (cancelled || isPdfRenderCancelled(error)) {
          return;
        }
        setPdfErrorMessage(getErrorMessage(error));
        setIsPdfRendering(false);
      }
    }

    void renderPdfPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDocument, pdfPageNumber, isPdfWorkspaceVisible]);

  useEffect(() => {
    if (isSuffixPopupOpen) {
      suffixInputRef.current?.focus();
      suffixInputRef.current?.select();
    }
  }, [isSuffixPopupOpen]);

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

    const pdfFiles = files.filter(isPdfFile);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const unsupportedFiles = files.filter(
      (file) => !isPdfFile(file) && !file.type.startsWith("image/")
    );

    setIsImporting(true);
    setErrorMessage(null);

    try {
      if (unsupportedFiles.length > 0) {
        throw new Error(`${unsupportedFiles[0].name} is not a supported image or PDF.`);
      }

      if (imageFiles.length > 0) {
        const imported = await Promise.all(
          imageFiles.map((file) => fileToQueueItem(file, session.webpQuality))
        );

        startTransition(() => {
          setQueue((current) => [...imported, ...current]);
          setSelectedItemId(imported[0]?.id ?? null);
          if (pdfFiles.length === 0) {
            setIsPdfWorkspaceVisible(false);
          }
        });
      }

      if (pdfFiles.length > 0) {
        await openPdfFile(pdfFiles[0]);
        if (pdfFiles.length > 1) {
          setErrorMessage("Opened the first PDF. Drop another PDF when you are ready to switch.");
        }
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsImporting(false);
    }
  }

  async function openPdfFile(file: File) {
    const data = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const nextDocument = await pdfjs.getDocument({ data }).promise;
    renderTaskRef.current?.cancel();

    setPdfDocument(nextDocument);
    setPdfName(file.name);
    setPdfPageNumber(1);
    setPdfPageCount(nextDocument.numPages);
    setPdfCropCount(0);
    setIsPdfWorkspaceVisible(true);
    setPdfErrorMessage(null);
    clearCropSelection();
  }

  async function handleFinalizePdfCrop() {
    const canvas = pdfCanvasRef.current;
    if (!canvas || !cropRect) {
      return;
    }

    const cleanedSuffix = sanitizeFilenameSegment(suffixDraft);
    const pdfBaseName = sanitizeFilenameSegment(removeFileExtension(pdfName)) || "pdf";
    const originalName = `${pdfBaseName}-p${pdfPageNumber}-crop-${pdfCropCount + 1}.png`;

    let pendingItem: QueueItem | null = null;

    try {
      if (!cleanedSuffix && !sanitizeFilenameSegment(session.firstToken)) {
        throw new Error("Enter a suffix or first token before finalizing files.");
      }

      const cropBlob = await cropCanvasToPngBlob(canvas, cropRect);
      pendingItem = await blobToQueueItem(
        cropBlob,
        originalName,
        "image/png",
        session.webpQuality
      );
      const draftItem = { ...pendingItem, suffix: cleanedSuffix };
      const nextItem = finalizeItem(session, draftItem, queue);

      startTransition(() => {
        setQueue((current) => [nextItem, ...current]);
        setSelectedItemId(nextItem.id);
      });
      setPdfCropCount((current) => current + 1);
      setErrorMessage(null);
      clearCropSelection();
      pdfViewportRef.current?.focus();
    } catch (error) {
      if (pendingItem) {
        await removeItemAssets(pendingItem);
      }
      setErrorMessage(getErrorMessage(error));
    }
  }

  function clearCropSelection() {
    cropStartRef.current = null;
    setCropRect(null);
    setIsCropDragging(false);
    setIsSuffixPopupOpen(false);
    setSuffixDraft("");
  }

  function handlePdfPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (isPdfRendering || !pdfDocument) {
      return;
    }

    const nextPoint = getPdfCanvasPoint(event);
    if (!nextPoint) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    cropStartRef.current = nextPoint;
    setCropRect({ ...nextPoint, width: 0, height: 0 });
    setIsCropDragging(true);
    setIsSuffixPopupOpen(false);
  }

  function handlePdfPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isCropDragging || !cropStartRef.current) {
      return;
    }

    const nextPoint = getPdfCanvasPoint(event);
    if (!nextPoint) {
      return;
    }

    setCropRect(normalizeRect(cropStartRef.current, nextPoint));
  }

  function handlePdfPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!isCropDragging) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsCropDragging(false);

    setCropRect((current) => {
      if (!current || current.width < MIN_CROP_SIZE || current.height < MIN_CROP_SIZE) {
        setIsSuffixPopupOpen(false);
        return null;
      }

      setIsSuffixPopupOpen(true);
      return current;
    });
  }

  function handlePdfPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearCropSelection();
  }

  function getPdfCanvasPoint(event: React.PointerEvent<HTMLDivElement>): Point | null {
    const canvas = pdfCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height)
    };
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
    renderTaskRef.current?.cancel();
    startTransition(() => {
      setSession(EMPTY_SESSION);
      setQueue([]);
      setSelectedItemId(null);
      setPdfDocument(null);
      setPdfName("");
      setPdfPageNumber(1);
      setPdfPageCount(0);
      setIsPdfWorkspaceVisible(false);
      setPdfCropCount(0);
      clearCropSelection();
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
            <strong>Drop images or a PDF anywhere</strong>
            <p>Images go to the queue. PDFs open in the crop workspace.</p>
          </div>
        </div>
      ) : null}
      <div className="shell">
      <aside className="sidebar">
        <section className="hero">
          <div className="hero-header">
            <div>
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

          <p className="lede">Crop PDFs, rename images, export WebP.</p>
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
              Import
            </button>
          </div>

          <input
            ref={fileInputRef}
            hidden
            multiple
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => {
              if (event.target.files) {
                void importFiles(event.target.files);
                event.target.value = "";
              }
            }}
          />
          <div
            className={`dropzone ${isDropActive ? "is-active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="drop-badge">{isImporting ? "..." : "+"}</div>
            <strong>{isImporting ? "Importing..." : "Drop PDF or images"}</strong>
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
        {pdfDocument && isPdfWorkspaceVisible ? (
          <section className="preview-surface pdf-surface" ref={pdfSurfaceRef}>
            <div className="pdf-topbar">
              <div className="pdf-title">
                <strong>{pdfName}</strong>
                <span>
                  Page {pdfPageNumber} of {pdfPageCount}
                </span>
              </div>

              <div className="pdf-actions">
                <button
                  className="ghost-button"
                  onClick={() => setPdfPageNumber((current) => Math.max(1, current - 1))}
                  disabled={pdfPageNumber <= 1 || isPdfRendering}
                >
                  Previous
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setPdfPageNumber((current) => Math.min(pdfPageCount, current + 1))}
                  disabled={pdfPageNumber >= pdfPageCount || isPdfRendering}
                >
                  Next
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setIsPdfWorkspaceVisible(false)}
                  disabled={!selectedItem}
                >
                  Selected
                </button>
              </div>
            </div>

            <div className="pdf-canvas-scroll">
              <div
                ref={pdfViewportRef}
                className="pdf-page-stage"
                tabIndex={0}
                onPointerDown={handlePdfPointerDown}
                onPointerMove={handlePdfPointerMove}
                onPointerUp={handlePdfPointerUp}
                onPointerCancel={handlePdfPointerCancel}
              >
                <canvas ref={pdfCanvasRef} aria-label={`Page ${pdfPageNumber} of ${pdfName}`} />
                {cropRect ? (
                  <div
                    className={`crop-rect ${isCropDragging ? "is-dragging" : ""}`}
                    style={{
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.width,
                      height: cropRect.height
                    }}
                  />
                ) : null}
                {isSuffixPopupOpen && cropRect ? (
                  <form
                    className="crop-suffix-popover"
                    style={getCropPopoverStyle(cropRect)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleFinalizePdfCrop();
                    }}
                  >
                    <label>
                      <span>Suffix</span>
                      <input
                        ref={suffixInputRef}
                        value={suffixDraft}
                        onChange={(event) => setSuffixDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            clearCropSelection();
                          }
                        }}
                        placeholder="q1_a"
                      />
                    </label>
                    <button type="submit">Enter</button>
                  </form>
                ) : null}
              </div>
            </div>

            <div className="pdf-status-row">
              <span>{isPdfRendering ? "Rendering page..." : "Drag to crop. Enter saves."}</span>
              {pdfErrorMessage ? <strong>{pdfErrorMessage}</strong> : null}
            </div>
          </section>
        ) : selectedItem ? (
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
                  <div className="button-row inline-actions">
                    {pdfDocument ? (
                      <button
                        className="ghost-button"
                        onClick={() => setIsPdfWorkspaceVisible(true)}
                      >
                        Back to PDF
                      </button>
                    ) : null}
                    <button
                      className="ghost-button"
                      onClick={() => void handleDeleteItem(selectedItem)}
                    >
                      Delete
                    </button>
                  </div>
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
                  onClick={() => {
                    setSelectedItemId(item.id);
                    setIsPdfWorkspaceVisible(false);
                  }}
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

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isPdfRenderCancelled(error: unknown) {
  return error instanceof Error && error.name === "RenderingCancelledException";
}

function removeFileExtension(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRect(start: Point, end: Point): CropRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function getCropPopoverStyle(rect: CropRect): CSSProperties {
  return {
    left: rect.x + rect.width + 10,
    top: rect.y
  };
}

async function cropCanvasToPngBlob(canvas: HTMLCanvasElement, rect: CropRect) {
  const displayRect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / displayRect.width;
  const scaleY = canvas.height / displayRect.height;
  const sourceX = Math.round(rect.x * scaleX);
  const sourceY = Math.round(rect.y * scaleY);
  const sourceWidth = Math.round(rect.width * scaleX);
  const sourceHeight = Math.round(rect.height * scaleY);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, sourceWidth);
  cropCanvas.height = Math.max(1, sourceHeight);

  const context = cropCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to prepare a crop canvas.");
  }

  context.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );

  return await new Promise<Blob>((resolve, reject) => {
    cropCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("The browser could not prepare this crop."));
    }, "image/png");
  });
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
