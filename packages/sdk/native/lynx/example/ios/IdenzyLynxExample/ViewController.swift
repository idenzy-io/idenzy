import UIKit

/// One full-screen LynxView showing `main.lynx.bundle`, with `NativeModules.Idenzy` registered on it.
final class ViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let config = LynxConfig(provider: BundleProvider())
        config.register(IdenzyLynxModule.self)
        let size = view.frame.size
        let lynxView = LynxView { builder in
            builder.config = config
            builder.screenSize = size
            builder.fontScale = 1.0
        }
        lynxView.preferredLayoutWidth = size.width
        lynxView.preferredLayoutHeight = size.height
        lynxView.layoutWidthMode = .exact
        lynxView.layoutHeightMode = .exact
        view.addSubview(lynxView)
        lynxView.loadTemplate(fromURL: "main.lynx", initData: nil)
    }
}
