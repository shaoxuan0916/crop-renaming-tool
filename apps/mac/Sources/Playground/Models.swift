import Foundation

enum WebPMode: String, Codable, CaseIterable {
    case lossyHigh = "lossy-high"
}

enum QueueItemStatus: String, Codable, CaseIterable {
    case pending
    case ready
    case error
}

struct BatchSession: Codable, Equatable {
    var firstToken: String = ""
    var destinationFolder: String = ""
    var webpMode: WebPMode = .lossyHigh
}

struct QueueItem: Identifiable, Codable, Equatable {
    var id: UUID
    var originalPath: String
    var tempWebPPath: String?
    var backupOriginalPath: String?
    var finalPath: String?
    var previewPath: String
    var suffix: String
    var finalName: String
    var status: QueueItemStatus
    var errorMessage: String?

    var originalURL: URL {
        URL(fileURLWithPath: originalPath)
    }

    var previewURL: URL {
        URL(fileURLWithPath: previewPath)
    }

    var finalURL: URL? {
        guard let finalPath else { return nil }
        return URL(fileURLWithPath: finalPath)
    }

    var isEditable: Bool {
        true
    }
}

struct SessionLogEntry: Codable {
    let id: UUID
    let finalName: String
    let finalPath: String?
    let originalPath: String
    let status: QueueItemStatus
}

struct RenameUndoAction {
    let itemID: UUID
    let originalPath: String
    let backupOriginalPath: String
    let finalPath: String
    let tempWebPPath: String?
}
