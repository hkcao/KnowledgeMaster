import Foundation
import Security

@MainActor
final class AppSettings: ObservableObject {
    @Published var provider: String { didSet { save() } }
    @Published var baseURL: String { didSet { save() } }
    @Published var model: String { didSet { save() } }
    @Published var chatBackend: ChatBackend { didSet { save() } }

    init() {
        let defaults = UserDefaults.standard
        provider = defaults.string(forKey: "provider") ?? "deepseek"
        baseURL = defaults.string(forKey: "baseURL") ?? "https://api.deepseek.com"
        model = defaults.string(forKey: "model") ?? "deepseek-chat"
        chatBackend = ChatBackend(rawValue: defaults.string(forKey: "chatBackend") ?? "") ?? .direct
    }

    var apiKey: String { Keychain.read() ?? "" }
    var hasAPIKey: Bool { !apiKey.isEmpty }

    func setAPIKey(_ value: String) throws {
        if value.isEmpty { try Keychain.delete() }
        else { try Keychain.write(value) }
        objectWillChange.send()
    }

    func applyDefaults(for provider: String) {
        self.provider = provider
        switch provider {
        case "deepseek":
            baseURL = "https://api.deepseek.com"
            model = "deepseek-chat"
        case "glm":
            baseURL = "https://open.bigmodel.cn/api/paas/v4"
            model = "glm-4-flash"
        default: break
        }
    }

    private func save() {
        let defaults = UserDefaults.standard
        defaults.set(provider, forKey: "provider")
        defaults.set(baseURL, forKey: "baseURL")
        defaults.set(model, forKey: "model")
        defaults.set(chatBackend.rawValue, forKey: "chatBackend")
    }
}

enum Keychain {
    private static let service = "com.hkcao.knowledgemaster"
    private static let account = "llm-api-key"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) throws {
        try? delete()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8)
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }
}
