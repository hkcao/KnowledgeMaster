import SwiftUI
import AppKit

@MainActor
final class KnowledgeMasterAppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) {
        AgentProcessRegistry.shared.terminateAll()
    }
}

@main
@MainActor
struct KnowledgeMasterApp: App {
    @NSApplicationDelegateAdaptor(KnowledgeMasterAppDelegate.self) private var appDelegate
    @StateObject private var store = KnowledgeStore()
    @StateObject private var settings = AppSettings()

    var body: some Scene {
        WindowGroup("知屿") {
            ContentView().environmentObject(store).environmentObject(settings)
        }
        .defaultSize(width: 1_460, height: 900)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("设置…") { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) }
                    .keyboardShortcut(",", modifiers: .command)
            }
            CommandMenu("知识问答") {
                ForEach(ChatPlacement.allCases) { placement in
                    Button {
                        settings.chatPlacement = placement
                    } label: {
                        Label(placement.name, systemImage: placement.icon)
                    }
                }
            }
        }
        Settings {
            SettingsView().environmentObject(store).environmentObject(settings)
        }
    }
}
