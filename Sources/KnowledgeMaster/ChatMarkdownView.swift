import SwiftUI
import WebKit
import AppKit

enum ChatMarkdownDocument {
    static func html(markdown: String) -> String {
        let source = (try? String(data: JSONEncoder().encode(markdown), encoding: .utf8)) ?? "\"\""
        let marked = resource("marked.min", extension: "js")
        let katex = resource("katex.min", extension: "js")
        let autoRender = resource("auto-render.min", extension: "js")
        let katexCSS = resource("katex.min", extension: "css")
        return """
        <!doctype html>
        <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src file:; img-src data: file:">
        <style>
        \(katexCSS)
        :root { color-scheme: light dark; }
        html, body { margin: 0; padding: 0; background: transparent; }
        body { font: 14px/1.62 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
               color: #1f2328; overflow: hidden; overflow-wrap: anywhere; }
        #content { padding: 1px 2px 4px; }
        p { margin: 0 0 .8em; }
        p:last-child { margin-bottom: 0; }
        h1, h2, h3, h4 { line-height: 1.3; margin: 1em 0 .45em; }
        h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
        h1 { font-size: 1.45em; } h2 { font-size: 1.28em; } h3 { font-size: 1.14em; }
        ul, ol { margin: .3em 0 .8em; padding-left: 1.7em; }
        li { margin: .18em 0; }
        blockquote { margin: .7em 0; padding: .2em .8em; border-left: 3px solid #8c959f; color: #57606a; }
        code { font: .92em ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(127,127,127,.13);
               border-radius: 4px; padding: .12em .3em; }
        pre { overflow-x: auto; padding: .75em; background: rgba(127,127,127,.12); border-radius: 7px; }
        pre code { background: transparent; padding: 0; }
        table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: .7em 0 1em; }
        th, td { border: 1px solid rgba(127,127,127,.35); padding: .35em .6em; text-align: left; }
        th { background: rgba(127,127,127,.10); }
        hr { border: 0; border-top: 1px solid rgba(127,127,127,.3); margin: 1em 0; }
        a { color: #0969da; text-decoration: none; }
        .katex-display { overflow-x: auto; overflow-y: hidden; margin: .8em 0; padding: .1em 0; }
        @media (prefers-color-scheme: dark) {
          body { color: #e6edf3; } blockquote { color: #9da7b1; } a { color: #58a6ff; }
        }
        </style>
        <script>\(marked)</script><script>\(katex)</script><script>\(autoRender)</script>
        </head><body><div id="content"></div><script>
        const markdownSource = \(source);
        const content = document.getElementById('content');
        content.innerHTML = marked.parse(markdownSource, {gfm: true, breaks: true});
        content.querySelectorAll('script, iframe, object, embed, style, link, meta, form').forEach(node => node.remove());
        content.querySelectorAll('*').forEach(node => {
          for (const attribute of [...node.attributes]) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc' ||
                ((name === 'href' || name === 'src') && (value.startsWith('javascript:') || value.startsWith('data:text/html')))) {
              node.removeAttribute(attribute.name);
            }
          }
        });
        renderMathInElement(content, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\\\[', right: '\\\\]', display: true},
            {left: '\\\\(', right: '\\\\)', display: false},
            {left: '$', right: '$', display: false}
          ],
          throwOnError: false
        });
        function reportHeight() {
          requestAnimationFrame(() => window.webkit.messageHandlers.height.postMessage(
            Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
          ));
        }
        reportHeight();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(reportHeight);
        new ResizeObserver(reportHeight).observe(content);
        </script></body></html>
        """
    }

    static var resourcesURL: URL? {
        if let applicationURL = Bundle.main.resourceURL?.appendingPathComponent("ChatRenderer", isDirectory: true),
           FileManager.default.fileExists(atPath: applicationURL.path) {
            return applicationURL
        }
        return Bundle.module.url(forResource: "katex.min", withExtension: "js", subdirectory: "ChatRenderer")?
            .deletingLastPathComponent() ?? Bundle.module.resourceURL
    }

    private static func resource(_ name: String, extension ext: String) -> String {
        let url = resourcesURL?.appendingPathComponent("\(name).\(ext)")
        return url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
    }
}

struct ChatMarkdownView: View {
    var markdown: String
    @State private var contentHeight: CGFloat = 28

    var body: some View {
        ChatMarkdownWebView(markdown: markdown, height: $contentHeight)
            .frame(height: max(24, contentHeight))
    }
}

private struct ChatMarkdownWebView: NSViewRepresentable {
    var markdown: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator(height: $height) }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "height")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.setValue(false, forKey: "drawsBackground")
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.height = $height
        guard context.coordinator.markdown != markdown else { return }
        context.coordinator.markdown = markdown
        view.loadHTMLString(ChatMarkdownDocument.html(markdown: markdown), baseURL: ChatMarkdownDocument.resourcesURL)
    }

    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "height")
        view.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var height: Binding<CGFloat>
        var markdown: String?

        init(height: Binding<CGFloat>) { self.height = height }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "height", let number = message.body as? NSNumber else { return }
            let value = max(24, CGFloat(number.doubleValue))
            if abs(height.wrappedValue - value) > 1 { height.wrappedValue = value }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }
}
