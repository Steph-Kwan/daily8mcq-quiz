import AppKit
import Security
import UniformTypeIdentifiers
import WebKit

/// Study records and settings live in ~/Library/Application Support/Daily 8/storage.json (question banks stay in
/// WebKit's IndexedDB and can always be re-imported). A copy of the previous file is kept on launch.
final class Store {
    let directory: URL
    let file: URL
    private(set) var values: [String: String] = [:]

    init() {
        if let override = ProcessInfo.processInfo.environment["DAILY8_DATA_DIR"] {
            directory = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Daily 8", isDirectory: true)
        }
        file = directory.appendingPathComponent("storage.json")
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: file),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            values = object
            let backup = directory.appendingPathComponent("storage.previous.json")
            try? FileManager.default.removeItem(at: backup)
            try? FileManager.default.copyItem(at: file, to: backup)
        }
    }

    func set(_ key: String, _ value: String?) {
        values[key] = value
        do {
            let data = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
            try data.write(to: file, options: .atomic)
        } catch {
            NSLog("Daily 8: could not save storage: \(error)")
        }
    }
}

/// The OpenAI API key is kept in the login Keychain rather than in storage.json.
enum Keychain {
    static let service = ProcessInfo.processInfo.environment["DAILY8_KEYCHAIN_SERVICE"] ?? "com.stephenkwan.daily8"

    static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func get(_ account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ account: String, _ value: String) {
        SecItemDelete(query(account) as CFDictionary)
        guard !value.isEmpty else { return }
        var q = query(account)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(q as CFDictionary, nil)
        if status != errSecSuccess { NSLog("Daily 8: Keychain write failed (\(status))") }
    }
}

/// Performs the page's API requests with URLSession and streams responses back to platform.js (see appFetch there).
final class NativeFetch: NSObject, URLSessionDataDelegate {
    weak var webView: WKWebView?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var ids: [Int: Int] = [:]          // task identifier -> page request id
    private var tasks: [Int: URLSessionDataTask] = [:]

    func start(id: Int, url: URL, method: String, headers: [String: String], body: String) {
        var request = URLRequest(url: url, timeoutInterval: 600)
        request.httpMethod = method
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        if !body.isEmpty { request.httpBody = Data(body.utf8) }
        let task = session.dataTask(with: request)
        ids[task.taskIdentifier] = id
        tasks[id] = task
        task.resume()
    }

    func cancel(id: Int) { tasks.removeValue(forKey: id)?.cancel() }

    private func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
        webView?.evaluateJavaScript("window.__daily8Fetch(" + String(decoding: data, as: UTF8.self) + ")")
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let id = ids[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else { return completionHandler(.cancel) }
        var headers: [String: String] = [:]
        for (k, v) in http.allHeaderFields { headers[String(describing: k).lowercased()] = String(describing: v) }
        send(["id": id, "kind": "head", "status": http.statusCode, "headers": headers])
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let id = ids[dataTask.taskIdentifier] else { return }
        send(["id": id, "kind": "chunk", "data": data.base64EncodedString()])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = ids.removeValue(forKey: task.taskIdentifier) else { return }
        tasks.removeValue(forKey: id)
        if let error = error { send(["id": id, "kind": "error", "message": error.localizedDescription]) }
        else { send(["id": id, "kind": "end"]) }
    }
}

/// Breaks the retain cycle between WKUserContentController and its handler.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let secretNames = ["openai-api-key"]
    let store = Store()
    let network = NativeFetch()
    var window: NSWindow!
    var webView: WKWebView!
    let paper = NSColor(red: 0xf6 / 255, green: 0xf7 / 255, blue: 0xf2 / 255, alpha: 1)
    var webRoot: URL { Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true) }
    var indexURL: URL { webRoot.appendingPathComponent("index.html") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.userContentController.add(WeakMessageHandler(self), name: "daily8")
        installBootstrap(on: config.userContentController)
        // Self tests use their own persistent WebKit store so imported test banks never mix with real data.
        if let id = ProcessInfo.processInfo.environment["DAILY8_WEBDATA_ID"].flatMap(UUID.init(uuidString:)), #available(macOS 14.0, *) {
            config.websiteDataStore = WKWebsiteDataStore(forIdentifier: id)
        }
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        network.webView = webView
        webView.uiDelegate = self
        webView.allowsMagnification = true
        webView.setValue(false, forKey: "drawsBackground")
        let zoom = UserDefaults.standard.double(forKey: "pageZoom")
        if zoom > 0 { webView.pageZoom = zoom }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Daily 8"
        window.minSize = NSSize(width: 820, height: 600)
        window.backgroundColor = paper
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MainWindow")
        window.makeKeyAndOrderFront(nil)

        loadHome()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func loadHome() {
        webView.loadFileURL(indexURL, allowingReadAccessTo: webRoot)
    }

    /// The page reads its saved state synchronously at startup, so the current values are injected before any page script runs.
    func installBootstrap(on controller: WKUserContentController) {
        var secrets: [String: String] = [:]
        for name in Self.secretNames { secrets[name] = Keychain.get(name) }
        let payload: [String: Any] = ["store": store.values, "secrets": secrets, "languages": Locale.preferredLanguages]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data(#"{"store":{},"secrets":{}}"#.utf8)
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: "window.__DAILY8_NATIVE__=" + String(decoding: data, as: UTF8.self) + ";",
                                              injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    // MARK: Bridge

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "set":
            if let key = body["key"] as? String, let value = body["value"] as? String { store.set(key, value) }
        case "remove":
            if let key = body["key"] as? String { store.set(key, nil) }
        case "secret":
            if let key = body["key"] as? String, Self.secretNames.contains(key), let value = body["value"] as? String { Keychain.set(key, value) }
        case "snapshot":
            // Self-test only: render the page to <DAILY8_SNAPSHOT_DIR>/<name>.png (works with the display asleep).
            guard let dir = ProcessInfo.processInfo.environment["DAILY8_SNAPSHOT_DIR"], let name = body["name"] as? String,
                  !name.contains("/"), !name.contains("..") else { return }
            let config = WKSnapshotConfiguration()
            config.rect = NSRect(origin: .zero, size: webView.bounds.size)
            webView.takeSnapshot(with: config) { image, _ in
                guard let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
                try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name + ".png"))
            }
        case "fetch":
            guard let id = body["id"] as? Int, let urlString = body["url"] as? String, let url = URL(string: urlString),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return }
            network.start(id: id, url: url, method: body["method"] as? String ?? "GET",
                          headers: body["headers"] as? [String: String] ?? [:], body: body["body"] as? String ?? "")
        case "fetchCancel":
            if let id = body["id"] as? Int { network.cancel(id: id) }
        case "save":
            if let name = body["name"] as? String, let b64 = body["base64"] as? String, let data = Data(base64Encoded: b64) { save(data, suggestedName: name) }
        default:
            break
        }
    }

    func save(_ data: Data, suggestedName: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        if let type = UTType(filenameExtension: (suggestedName as NSString).pathExtension) { panel.allowedContentTypes = [type] }
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                NSAlert(error: error).beginSheetModal(for: self.window)
            }
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.isFileURL {
            // Only the app's own page may load; a file dropped outside the drop zone must not replace it.
            guard url.standardizedFileURL.path == indexURL.standardizedFileURL.path else { return decisionHandler(.cancel) }
            // Reloads (menu or the page's own button) must see the latest saved state.
            if action.targetFrame?.isMainFrame == true { installBootstrap(on: webView.configuration.userContentController) }
            decisionHandler(.allow)
        } else if ["about", "blob", "data"].contains(url.scheme ?? "") {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, !url.isFileURL { NSWorkspace.shared.open(url) }
        return nil
    }

    /// DAILY8_SELFTEST=<file.js> runs that script in the page once loaded, prints its result and quits (used by scripts/test_mac.sh).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let path = ProcessInfo.processInfo.environment["DAILY8_SELFTEST"],
              let script = try? String(contentsOfFile: path, encoding: .utf8) else { return }
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): print("SELFTEST", value ?? "null")
            case .failure(let error): print("SELFTEST ERROR", error)
            }
            fflush(stdout)
            NSApp.terminate(nil)
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadHome()
    }

    // MARK: Panels

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    // MARK: Menu actions

    @objc func reloadPage(_ sender: Any?) { webView.reload() }
    @objc func importBank(_ sender: Any?) { webView.evaluateJavaScript("go('banks'); document.querySelector('#import-files')?.click()") }
    @objc func exportBackup(_ sender: Any?) { webView.evaluateJavaScript("exportBackup()") }
    @objc func showDataFolder(_ sender: Any?) { NSWorkspace.shared.activateFileViewerSelecting([store.file]) }
    @objc func zoomIn(_ sender: Any?) { setZoom(webView.pageZoom + 0.1) }
    @objc func zoomOut(_ sender: Any?) { setZoom(webView.pageZoom - 0.1) }
    @objc func actualSize(_ sender: Any?) { setZoom(1) }

    func setZoom(_ value: CGFloat) {
        webView.pageZoom = min(2, max(0.6, (value * 10).rounded() / 10))
        UserDefaults.standard.set(Double(webView.pageZoom), forKey: "pageZoom")
    }

    func buildMenu() {
        let main = NSMenu()

        func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            let holder = NSMenuItem()
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            item.target = target
            return item
        }

        _ = submenu("Daily 8", [
            item("关于 Daily 8", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            .separator(),
            item("隐藏 Daily 8", #selector(NSApplication.hide(_:)), "h"),
            item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("全部显示", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("退出 Daily 8", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = submenu("文件", [
            item("导入题库…", #selector(importBank(_:)), "o", target: self),
            item("导出学习记录…", #selector(exportBackup(_:)), "e", target: self),
            item("在访达中显示数据文件", #selector(showDataFolder(_:)), target: self),
            .separator(),
            item("关闭窗口", #selector(NSWindow.performClose(_:)), "w"),
        ])
        _ = submenu("编辑", [
            item("撤销", Selector(("undo:")), "z"),
            item("重做", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("剪切", #selector(NSText.cut(_:)), "x"),
            item("拷贝", #selector(NSText.copy(_:)), "c"),
            item("粘贴", #selector(NSText.paste(_:)), "v"),
            item("全选", #selector(NSText.selectAll(_:)), "a"),
        ])
        _ = submenu("显示", [
            item("重新载入", #selector(reloadPage(_:)), "r", target: self),
            .separator(),
            item("实际大小", #selector(actualSize(_:)), "0", target: self),
            item("放大", #selector(zoomIn(_:)), "=", target: self),
            item("缩小", #selector(zoomOut(_:)), "-", target: self),
            .separator(),
            item("进入全屏幕", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        let windowMenu = submenu("窗口", [
            item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("缩放", #selector(NSWindow.performZoom(_:))),
        ])
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
