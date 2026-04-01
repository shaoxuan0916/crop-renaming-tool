import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class AppViewModel: ObservableObject {
    @Published var session = BatchSession()
    @Published var queue: [QueueItem] = []
    @Published var selectedItemID: QueueItem.ID?
    @Published var alertMessage: String?
    @Published var presets: [String] = UserDefaults.standard.stringArray(forKey: "batch-presets") ?? []
    @Published var isDropTargeted = false

    private let workflowService = FileWorkflowService()
    private var undoStack: [RenameUndoAction] = []

    var selectedItem: QueueItem? {
        guard let selectedItemID else { return nil }
        return queue.first(where: { $0.id == selectedItemID })
    }

    var canFinalizeSelected: Bool {
        guard let selectedItem else { return false }
        return selectedItem.status == .pending && !session.firstToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canUndo: Bool {
        !undoStack.isEmpty
    }

    var firstTokenBinding: Binding<String> {
        Binding(
            get: { self.session.firstToken },
            set: { self.session.firstToken = $0 }
        )
    }

    var destinationFolderBinding: Binding<String> {
        Binding(
            get: { self.session.destinationFolder },
            set: { self.session.destinationFolder = $0 }
        )
    }

    func setSelectedItem(_ id: QueueItem.ID?) {
        selectedItemID = id
    }

    func chooseDestinationFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose Folder"

        if panel.runModal() == .OK {
            session.destinationFolder = panel.url?.path ?? session.destinationFolder
        }
    }

    func handleDrop(providers: [NSItemProvider]) {
        guard !session.destinationFolder.isEmpty else {
            alertMessage = "Choose a destination folder before dropping files."
            return
        }

        Task {
            var importedCount = 0

            for provider in providers {
                do {
                    let fileURL = try await provider.loadFileURL()
                    let prepared = try workflowService.prepareDroppedFile(
                        fileURL: fileURL,
                        destinationFolder: URL(fileURLWithPath: session.destinationFolder, isDirectory: true)
                    )
                    queue.insert(prepared, at: 0)
                    selectedItemID = prepared.id
                    importedCount += 1
                } catch {
                    alertMessage = error.localizedDescription
                }
            }

            if importedCount == 0, alertMessage == nil {
                alertMessage = "The drop was received, but no image file could be imported."
            }
        }
    }

    func updateSelectedSuffix(_ suffix: String) {
        guard let selectedItemID, let index = queue.firstIndex(where: { $0.id == selectedItemID }) else { return }
        queue[index].suffix = suffix
    }

    func finalizeSelectedItem() {
        guard let selectedItemID, let index = queue.firstIndex(where: { $0.id == selectedItemID }) else { return }
        do {
            let (updated, undoAction) = try workflowService.finalize(item: queue[index], session: session)
            queue[index] = updated
            undoStack.append(undoAction)
            try exportSessionLog()
        } catch {
            queue[index].status = .error
            queue[index].errorMessage = error.localizedDescription
            alertMessage = error.localizedDescription
        }
    }

    func renameReadyItem(_ itemID: QueueItem.ID) {
        guard let index = queue.firstIndex(where: { $0.id == itemID }) else { return }
        do {
            queue[index] = try workflowService.updateFinalName(item: queue[index], session: session)
            try exportSessionLog()
        } catch {
            queue[index].status = .error
            queue[index].errorMessage = error.localizedDescription
            alertMessage = error.localizedDescription
        }
    }

    func retryItem(_ itemID: QueueItem.ID) {
        guard let index = queue.firstIndex(where: { $0.id == itemID }) else { return }
        let item = queue[index]
        switch item.status {
        case .pending, .error:
            let previousSelection = selectedItemID
            selectedItemID = itemID
            finalizeSelectedItem()
            selectedItemID = previousSelection ?? itemID
        case .ready:
            renameReadyItem(itemID)
        }
    }

    func undoLastRename() {
        guard let action = undoStack.popLast() else { return }
        do {
            try workflowService.undo(action: action)
            if let index = queue.firstIndex(where: { $0.id == action.itemID }) {
                workflowService.cleanup(for: queue[index])
                queue.remove(at: index)
            }
            try exportSessionLog()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func savePreset() {
        let cleaned = workflowService.sanitizeFilenameSegment(session.firstToken)
        guard !cleaned.isEmpty else {
            alertMessage = "Enter a first token before saving a preset."
            return
        }
        if !presets.contains(cleaned) {
            presets.insert(cleaned, at: 0)
            UserDefaults.standard.set(presets, forKey: "batch-presets")
        }
        session.firstToken = cleaned
    }

    func applyPreset(_ preset: String) {
        session.firstToken = preset
    }

    func removePreset(_ preset: String) {
        presets.removeAll { $0 == preset }
        UserDefaults.standard.set(presets, forKey: "batch-presets")

        if session.firstToken == preset {
            session.firstToken = ""
        }
    }

    func exportSessionLog() throws {
        guard !session.destinationFolder.isEmpty else { return }
        let logEntries = queue.map {
            SessionLogEntry(
                id: $0.id,
                finalName: $0.finalName,
                finalPath: $0.finalPath,
                originalPath: $0.originalPath,
                status: $0.status
            )
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(logEntries)
        let logURL = URL(fileURLWithPath: session.destinationFolder, isDirectory: true).appendingPathComponent("crop-session-log.json")
        try data.write(to: logURL, options: .atomic)
    }
}

private extension NSItemProvider {
    func loadFileURL() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            if self.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                self.loadInPlaceFileRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { url, _, error in
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }

                    if let url {
                        continuation.resume(returning: url)
                        return
                    }

                    self.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, fallbackError in
                        if let fallbackError {
                            continuation.resume(throwing: fallbackError)
                            return
                        }

                        if let url = Self.extractURL(from: item) {
                            continuation.resume(returning: url)
                            return
                        }

                        continuation.resume(throwing: WorkflowError.fileNotFound)
                    }
                }
                return
            }

            let imageTypeIdentifiers = self.registeredTypeIdentifiers.filter {
                if let type = UTType($0) {
                    return type.conforms(to: .image)
                }
                return false
            }

            if let preferredImageType = imageTypeIdentifiers.first {
                self.loadDataRepresentation(forTypeIdentifier: preferredImageType) { data, error in
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }

                    guard let data, !data.isEmpty else {
                        continuation.resume(throwing: WorkflowError.fileNotFound)
                        return
                    }

                    do {
                        let materializedURL = try Self.materializeDroppedImage(data: data, typeIdentifier: preferredImageType)
                        continuation.resume(returning: materializedURL)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
                return
            }

            loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                if let url = Self.extractURL(from: item) {
                    continuation.resume(returning: url)
                    return
                }

                continuation.resume(throwing: WorkflowError.fileNotFound)
            }
        }
    }

    static func extractURL(from item: NSSecureCoding?) -> URL? {
        if let url = item as? URL {
            return url
        }

        if let data = item as? Data {
            if let url = URL(dataRepresentation: data, relativeTo: nil), url.isFileURL {
                return url
            }

            if let path = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               let url = URL(string: path),
               url.isFileURL {
                return url
            }
        }

        if let string = item as? String,
           let url = URL(string: string),
           url.isFileURL {
            return url
        }

        return nil
    }

    static func materializeDroppedImage(data: Data, typeIdentifier: String) throws -> URL {
        let type = UTType(typeIdentifier)
        let ext = type?.preferredFilenameExtension ?? "img"
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("crop-renamer-imports", isDirectory: true)

        if !FileManager.default.fileExists(atPath: tempDirectory.path) {
            try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        }

        let fileURL = tempDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(ext)
        try data.write(to: fileURL, options: .atomic)
        return fileURL
    }

}
