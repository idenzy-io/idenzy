import Foundation

/// Loads a page from the app's own resources: `main.lynx` is `main.lynx.bundle`, built into
/// `../dist` by `npm run build` and copied in by the project.
final class BundleProvider: NSObject, LynxTemplateProvider {
    func loadTemplate(withUrl url: String!, onComplete callback: LynxTemplateLoadBlock!) {
        guard
            let path = Bundle.main.path(forResource: url, ofType: "bundle"),
            let page = FileManager.default.contents(atPath: path)
        else {
            let missing = "No \(url ?? "page") in the app bundle; run `npm run build` first."
            callback(nil, NSError(domain: "io.idenzy.lynxexample", code: 404, userInfo: [NSLocalizedDescriptionKey: missing]))
            return
        }
        callback(page, nil)
    }
}
