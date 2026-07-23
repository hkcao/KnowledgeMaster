import Foundation

enum WebPageImportError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int)
    case unsupportedContentType(String)
    case contentTooLarge

    var errorDescription: String? {
        switch self {
        case .invalidURL: "请输入有效的 HTTP 或 HTTPS 网址"
        case .invalidResponse: "网页服务器返回了无效响应"
        case .httpStatus(let status): "网页请求失败（HTTP \(status)）"
        case .unsupportedContentType(let type): "该网址返回的不是 HTML 网页（\(type)）"
        case .contentTooLarge: "网页内容超过 25 MB，未导入"
        }
    }
}

enum WebPageImporter {
    static let maximumContentSize = 25 * 1_024 * 1_024

    static func normalizedURL(from input: String) -> URL? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let candidate = value.contains("://") ? value : "https://\(value)"
        guard let url = URL(string: candidate),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host?.isEmpty == false else { return nil }
        return url
    }

    static func fetch(from input: String) async throws -> (content: Data, sourceURL: URL) {
        guard let url = normalizedURL(from: input) else { throw WebPageImportError.invalidURL }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 KnowledgeMaster/1.0",
            forHTTPHeaderField: "User-Agent"
        )
        let (content, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw WebPageImportError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw WebPageImportError.httpStatus(http.statusCode) }
        guard content.count <= maximumContentSize else { throw WebPageImportError.contentTooLarge }

        let contentType = http.mimeType?.lowercased()
        let htmlTypes = ["text/html", "application/xhtml+xml"]
        let prefix = String(data: content.prefix(1_024), encoding: .utf8)?.lowercased() ?? ""
        guard contentType == nil || htmlTypes.contains(contentType!) ||
                prefix.contains("<html") || prefix.contains("<!doctype html") else {
            throw WebPageImportError.unsupportedContentType(contentType ?? "未知类型")
        }
        return (content, http.url ?? url)
    }
}
