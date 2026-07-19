import Foundation
import Security

@MainActor
final class AppSettings: ObservableObject {
    @Published var provider: String { didSet { save() } }
    @Published var baseURL: String { didSet { save() } }
    @Published var model: String { didSet { save() } }
    @Published var chatBackend: ChatBackend { didSet { save() } }
    @Published var chatPlacement: ChatPlacement { didSet { save() } }
    @Published var apiContextMode: APIContextMode { didSet { save() } }
    @Published private(set) var apiKey: String
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard, apiKeyLoader: () -> String? = Keychain.read) {
        self.defaults = defaults
        provider = defaults.string(forKey: "provider") ?? "deepseek"
        baseURL = defaults.string(forKey: "baseURL") ?? "https://api.deepseek.com"
        model = defaults.string(forKey: "model") ?? "deepseek-chat"
        chatBackend = ChatBackend(rawValue: defaults.string(forKey: "chatBackend") ?? "") ?? .direct
        chatPlacement = ChatPlacement(rawValue: defaults.string(forKey: "chatPlacement") ?? "") ?? .right
        apiContextMode = APIContextMode(rawValue: defaults.string(forKey: "apiContextMode") ?? "") ?? .relevantFragments
        apiKey = apiKeyLoader() ?? ""
    }

    var hasAPIKey: Bool { !apiKey.isEmpty }

    func setAPIKey(_ value: String) throws {
        if value.isEmpty { try Keychain.delete() }
        else { try Keychain.write(value) }
        apiKey = value
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
        defaults.set(provider, forKey: "provider")
        defaults.set(baseURL, forKey: "baseURL")
        defaults.set(model, forKey: "model")
        defaults.set(chatBackend.rawValue, forKey: "chatBackend")
        defaults.set(chatPlacement.rawValue, forKey: "chatPlacement")
        defaults.set(apiContextMode.rawValue, forKey: "apiContextMode")
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
