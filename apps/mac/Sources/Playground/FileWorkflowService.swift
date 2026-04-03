import Foundation

struct FileWorkflowService {
    private let fileManager = FileManager.default
    private let webPQuality = "90"

    func prepareDroppedFile(fileURL: URL, destinationFolder: URL) throws -> QueueItem {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw WorkflowError.fileNotFound
        }

        let tempDirectory = try makeTemporaryDirectory(for: fileURL)
        let tempWebPURL = tempDirectory.appendingPathComponent(fileURL.deletingPathExtension().lastPathComponent).appendingPathExtension("webp")
        let originalExtension = fileURL.pathExtension
        guard !originalExtension.isEmpty else {
            throw WorkflowError.unsupportedFormat
        }

        do {
            try convertImageToWebp(inputPath: fileURL, outputPath: tempWebPURL)
        } catch let error as WorkflowError {
            throw error
        } catch {
            throw WorkflowError.conversionFailed(error.localizedDescription)
        }

        return QueueItem(
            id: UUID(),
            originalPath: fileURL.path,
            tempWebPPath: tempWebPURL.path,
            backupOriginalPath: nil,
            finalPath: nil,
            previewPath: tempWebPURL.path,
            suffix: "",
            finalName: buildFinalFilename(firstToken: "", suffix: ""),
            status: .pending,
            errorMessage: nil
        )
    }

    func finalize(item: QueueItem, session: BatchSession) throws -> (QueueItem, RenameUndoAction) {
        guard let tempWebPPath = item.tempWebPPath else {
            throw WorkflowError.missingPreparedImage
        }

        let tempWebPURL = URL(fileURLWithPath: tempWebPPath)
        let originalURL = URL(fileURLWithPath: item.originalPath)
        let destinationFolderURL = URL(fileURLWithPath: session.destinationFolder, isDirectory: true)

        guard fileManager.fileExists(atPath: tempWebPURL.path) else {
            throw WorkflowError.fileNotFound
        }

        let firstToken = sanitizeFilenameSegment(session.firstToken)
        let sanitizedSuffix = sanitizeFilenameSegment(item.suffix)
        let finalName = buildFinalFilename(firstToken: firstToken, suffix: sanitizedSuffix)
        guard !finalName.isEmpty else {
            throw WorkflowError.missingFilenameTokens
        }
        let finalURL = destinationFolderURL.appendingPathComponent(finalName).appendingPathExtension("webp")

        if fileManager.fileExists(atPath: finalURL.path) {
            throw WorkflowError.filenameCollision(finalURL.lastPathComponent)
        }

        try ensureDirectory(destinationFolderURL)

        let backupURL = try makeBackupURL(for: item.id, originalURL: originalURL)
        try moveReplacingExisting(from: originalURL, to: backupURL)
        do {
            try moveReplacingExisting(from: tempWebPURL, to: finalURL)
        } catch {
            try? moveReplacingExisting(from: backupURL, to: originalURL)
            throw error
        }

        var updated = item
        updated.suffix = sanitizedSuffix
        updated.finalName = finalURL.lastPathComponent
        updated.finalPath = finalURL.path
        updated.previewPath = finalURL.path
        updated.backupOriginalPath = backupURL.path
        updated.status = .ready
        updated.errorMessage = nil
        updated.tempWebPPath = nil

        return (
            updated,
            RenameUndoAction(
                itemID: item.id,
                originalPath: originalURL.path,
                backupOriginalPath: backupURL.path,
                finalPath: finalURL.path,
                tempWebPPath: nil
            )
        )
    }

    func updateFinalName(item: QueueItem, session: BatchSession) throws -> QueueItem {
        guard let finalPath = item.finalPath else {
            throw WorkflowError.missingFinalPath
        }

        let firstToken = sanitizeFilenameSegment(session.firstToken)
        let sanitizedSuffix = sanitizeFilenameSegment(item.suffix)
        let newName = buildFinalFilename(firstToken: firstToken, suffix: sanitizedSuffix)
        guard !newName.isEmpty else {
            throw WorkflowError.missingFilenameTokens
        }
        let currentURL = URL(fileURLWithPath: finalPath)
        let newURL = currentURL.deletingLastPathComponent().appendingPathComponent(newName).appendingPathExtension("webp")

        if currentURL == newURL {
            var same = item
            same.finalName = newURL.lastPathComponent
            same.suffix = sanitizedSuffix
            return same
        }

        if fileManager.fileExists(atPath: newURL.path) {
            throw WorkflowError.filenameCollision(newURL.lastPathComponent)
        }

        try moveReplacingExisting(from: currentURL, to: newURL)

        var updated = item
        updated.suffix = sanitizedSuffix
        updated.finalName = newURL.lastPathComponent
        updated.finalPath = newURL.path
        updated.previewPath = newURL.path
        updated.status = .ready
        updated.errorMessage = nil
        return updated
    }

    func undo(action: RenameUndoAction) throws {
        let originalURL = URL(fileURLWithPath: action.originalPath)
        let backupURL = URL(fileURLWithPath: action.backupOriginalPath)
        let finalURL = URL(fileURLWithPath: action.finalPath)

        if fileManager.fileExists(atPath: finalURL.path) {
            try fileManager.removeItem(at: finalURL)
        }

        if fileManager.fileExists(atPath: backupURL.path) {
            try moveReplacingExisting(from: backupURL, to: originalURL)
        }
    }

    func cleanup(for item: QueueItem) {
        [item.tempWebPPath, item.backupOriginalPath].compactMap { $0 }.forEach { path in
            let url = URL(fileURLWithPath: path)
            if fileManager.fileExists(atPath: url.path) {
                try? fileManager.removeItem(at: url)
            }
        }
    }

    func convertImageToWebp(inputPath: URL, outputPath: URL) throws {
        guard let converterURL = resolveCWebPExecutable() else {
            throw WorkflowError.converterMissing
        }

        let process = Process()
        process.executableURL = converterURL
        process.arguments = [
            "-quiet",
            "-q", webPQuality,
            inputPath.path,
            "-o", outputPath.path
        ]

        let errorPipe = Pipe()
        let outputPipe = Pipe()
        process.standardError = errorPipe
        process.standardOutput = outputPipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            throw WorkflowError.conversionFailed(error.localizedDescription)
        }

        guard process.terminationStatus == 0, fileManager.fileExists(atPath: outputPath.path) else {
            let stderr = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let stdout = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let details = [stderr, stdout]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            throw WorkflowError.conversionFailed(details.isEmpty ? "cwebp failed to create the WebP file." : details)
        }
    }

    func buildFinalFilename(firstToken: String, suffix: String) -> String {
        let cleanedFirstToken = sanitizeFilenameSegment(firstToken)
        let cleanedSuffix = sanitizeFilenameSegment(suffix)
        if cleanedSuffix.isEmpty {
            return cleanedFirstToken
        }
        if cleanedFirstToken.isEmpty {
            return cleanedSuffix
        }
        return "\(cleanedFirstToken)_\(cleanedSuffix)"
    }

    func sanitizeFilenameSegment(_ value: String) -> String {
        let invalidCharacters = CharacterSet(charactersIn: "/\\?%*|\"<>:\n\r\t")
        let raw = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let replaced = raw.components(separatedBy: invalidCharacters).joined(separator: "_")
        let normalizedWhitespace = replaced.replacingOccurrences(of: "\\s+", with: "_", options: .regularExpression)
        let collapsedUnderscores = normalizedWhitespace.replacingOccurrences(of: "_{2,}", with: "_", options: .regularExpression)
        return collapsedUnderscores.trimmingCharacters(in: CharacterSet(charactersIn: "._ "))
    }

    private func makeTemporaryDirectory(for fileURL: URL) throws -> URL {
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("crop-renamer", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try ensureDirectory(directory)
        return directory
    }

    private func makeBackupURL(for id: UUID, originalURL: URL) throws -> URL {
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("crop-renamer-backups", isDirectory: true)
            .appendingPathComponent(id.uuidString, isDirectory: true)
        try ensureDirectory(directory)
        return directory.appendingPathComponent(originalURL.lastPathComponent)
    }

    private func ensureDirectory(_ directory: URL) throws {
        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    private func moveReplacingExisting(from source: URL, to destination: URL) throws {
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: source, to: destination)
    }

    private func resolveCWebPExecutable() -> URL? {
        let candidatePaths = [
            "/opt/homebrew/bin/cwebp",
            "/usr/local/bin/cwebp"
        ]

        for path in candidatePaths where fileManager.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }

        if let searchPath = ProcessInfo.processInfo.environment["PATH"] {
            for path in searchPath.split(separator: ":") {
                let candidate = URL(fileURLWithPath: String(path)).appendingPathComponent("cwebp")
                if fileManager.isExecutableFile(atPath: candidate.path) {
                    return candidate
                }
            }
        }

        return nil
    }
}

enum WorkflowError: LocalizedError {
    case fileNotFound
    case unsupportedFormat
    case conversionFailed(String)
    case converterMissing
    case missingPreparedImage
    case missingFilenameTokens
    case missingFinalPath
    case filenameCollision(String)

    var errorDescription: String? {
        switch self {
        case .fileNotFound:
            return "The dropped file could not be found."
        case .unsupportedFormat:
            return "The dropped file could not be converted to WebP."
        case let .conversionFailed(message):
            return "WebP conversion failed: \(message)"
        case .converterMissing:
            return "WebP conversion requires cwebp. Install it with `brew install webp`."
        case .missingPreparedImage:
            return "This item is missing its prepared WebP file."
        case .missingFilenameTokens:
            return "Enter a suffix or first token before finalizing files."
        case .missingFinalPath:
            return "The final file path is missing for this item."
        case let .filenameCollision(name):
            return "A file named \(name) already exists in the destination folder."
        }
    }
}
