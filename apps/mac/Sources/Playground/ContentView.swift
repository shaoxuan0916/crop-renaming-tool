import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var viewModel: AppViewModel
    @State private var isPresetManagerPresented = false

    var body: some View {
        NavigationSplitView {
            queuePane
        } detail: {
            detailPane
        }
        .navigationTitle("Crop Renamer")
        .sheet(isPresented: $isPresetManagerPresented) {
            PresetManagerSheet(isPresented: $isPresetManagerPresented)
                .environmentObject(viewModel)
        }
        .alert("Workflow Error", isPresented: Binding(get: {
            viewModel.alertMessage != nil
        }, set: { newValue in
            if !newValue {
                viewModel.alertMessage = nil
            }
        })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.alertMessage ?? "")
        }
    }

    private var queuePane: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Batch Setup")
                .font(.title2.weight(.semibold))

            VStack(alignment: .leading, spacing: 12) {
                TextField("First token", text: viewModel.firstTokenBinding)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    TextField("Destination folder", text: viewModel.destinationFolderBinding)
                        .textFieldStyle(.roundedBorder)
                    Button("Choose…") {
                        viewModel.chooseDestinationFolder()
                    }
                }
                HStack(spacing: 8) {
                    Button("Save Preset") {
                        viewModel.savePreset()
                    }
                    if !viewModel.presets.isEmpty {
                        Menu("Use Preset") {
                            ForEach(viewModel.presets, id: \.self) { preset in
                                Button(preset) {
                                    viewModel.applyPreset(preset)
                                }
                            }
                        }

                        Button("Manage Presets") {
                            isPresetManagerPresented = true
                        }
                    }
                }
            }

            DropZoneView()
                .environmentObject(viewModel)

            Divider()

            HStack {
                Text("Queue")
                    .font(.headline)
                Spacer()
                Text("\(viewModel.queue.count) items")
                    .foregroundStyle(.secondary)
            }

            List(selection: Binding(get: {
                viewModel.selectedItemID.map { Set([$0]) } ?? []
            }, set: { newValue in
                viewModel.setSelectedItem(newValue.first)
            })) {
                ForEach(viewModel.queue) { item in
                    QueueRow(item: item)
                        .tag(item.id)
                }
            }
            .listStyle(.inset)
        }
        .padding(20)
        .frame(minWidth: 420)
    }

    private var detailPane: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let item = viewModel.selectedItem {
                if let image = NSImage(contentsOf: item.previewURL) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: 360)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                } else {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.gray.opacity(0.12))
                        .frame(height: 260)
                        .overlay(Text("Preview unavailable"))
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text(item.originalURL.lastPathComponent)
                        .font(.headline)
                    TextField(
                        "Suffix",
                        text: Binding(
                            get: { item.suffix },
                            set: { viewModel.updateSelectedSuffix($0) }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                    .disabled(!item.isEditable)
                    .onSubmit {
                        if item.status == .pending {
                            viewModel.finalizeSelectedItem()
                        } else if item.status == .ready {
                            viewModel.renameReadyItem(item.id)
                        }
                    }

                    LabeledContent("Final name", value: item.finalName.isEmpty ? "Not finalized yet" : item.finalName)
                    LabeledContent("Status", value: item.status.rawValue.capitalized)

                    if let message = item.errorMessage, !message.isEmpty {
                        Text(message)
                            .foregroundStyle(.red)
                    }

                    HStack(spacing: 10) {
                        Button("Finalize") {
                            viewModel.finalizeSelectedItem()
                        }
                        .disabled(item.status == .ready)

                        Button("Rename") {
                            viewModel.renameReadyItem(item.id)
                        }
                        .disabled(item.status != .ready)

                        Button("Retry") {
                            viewModel.retryItem(item.id)
                        }
                    }
                }

                Divider()
            } else {
                ContentUnavailableView("Drop a cropped image to start", systemImage: "tray.and.arrow.down")
            }
        }
        .padding(20)
    }
}

private struct PresetManagerSheet: View {
    @EnvironmentObject private var viewModel: AppViewModel
    @Binding var isPresented: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("User Presets")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Done") {
                    isPresented = false
                }
            }

            if viewModel.presets.isEmpty {
                ContentUnavailableView(
                    "No presets saved",
                    systemImage: "tray",
                    description: Text("Save a first token as a preset from the main screen.")
                )
            } else {
                List {
                    ForEach(viewModel.presets, id: \.self) { preset in
                        Button {
                            viewModel.applyPreset(preset)
                            isPresented = false
                        } label: {
                            HStack {
                                Text(preset)
                                Spacer()
                                if viewModel.session.firstToken == preset {
                                    Text("Current")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Delete", role: .destructive) {
                                viewModel.removePreset(preset)
                            }
                        }
                    }
                }
                .listStyle(.inset)

                Text("Tip: right-click a preset to delete it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(20)
        .frame(minWidth: 420, minHeight: 320)
    }
}

private struct DropZoneView: View {
    @EnvironmentObject private var viewModel: AppViewModel

    var body: some View {
        RoundedRectangle(cornerRadius: 18)
            .fill(viewModel.isDropTargeted ? Color.accentColor.opacity(0.18) : Color.gray.opacity(0.12))
            .overlay {
                VStack(spacing: 10) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 36))
                    Text("Drop cropped images here")
                        .font(.headline)
                    Text("Each file is converted to WebP immediately, then you finalize the suffix.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding()
            }
            .frame(height: 180)
            .onDrop(
                of: [
                    UTType.fileURL,
                    UTType.image,
                    UTType.png,
                    UTType.jpeg,
                    UTType.tiff
                ],
                isTargeted: $viewModel.isDropTargeted
            ) { providers in
                viewModel.handleDrop(providers: providers)
                return true
            }
    }
}

private struct QueueRow: View {
    let item: QueueItem

    var body: some View {
        HStack(spacing: 12) {
            if let image = NSImage(contentsOf: item.previewURL) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.gray.opacity(0.16))
                    .frame(width: 44, height: 44)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.finalName.isEmpty ? item.originalURL.lastPathComponent : item.finalName)
                    .lineLimit(1)
                Text(item.status.rawValue.capitalized)
                    .font(.caption)
                    .foregroundStyle(statusColor)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch item.status {
        case .pending:
            return .orange
        case .ready:
            return .blue
        case .error:
            return .red
        }
    }
}
