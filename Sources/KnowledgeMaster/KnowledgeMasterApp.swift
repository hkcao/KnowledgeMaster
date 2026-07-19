import SwiftUI

@main
@MainActor
struct KnowledgeMasterApp: App {
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
        }
        Settings {
            SettingsView().environmentObject(store).environmentObject(settings)
        }
    }
}
