#import <Foundation/Foundation.h>
#import <Lynx/LynxContextModule.h>

NS_ASSUME_NONNULL_BEGIN

/// Lynx's half on iOS: `NativeModules.Idenzy`, one method onto `IdenzyBridge` and one global event.
///
/// The method table, the value mapping and the session itself are the Swift SDK's, shared with every
/// other framework (ADR-0022). Register it once, before the first `LynxView`:
/// `[globalConfig registerModule:IdenzyLynxModule.class]`.
@interface IdenzyLynxModule : NSObject <LynxContextModule>
@end

NS_ASSUME_NONNULL_END
