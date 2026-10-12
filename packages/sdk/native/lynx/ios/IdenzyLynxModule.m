#import "IdenzyLynxModule.h"

@import IdenzyBridge;

static NSString *const IdenzyStatusEvent = @"idenzy:status";

@implementation IdenzyLynxModule {
  __weak LynxContext *_context;
  // Touched on the main thread only, like the bridge it names a watch of.
  NSString *_watch;
}

+ (NSString *)name {
  return @"Idenzy";
}

+ (NSDictionary<NSString *, NSString *> *)methodLookup {
  return @{
    @"call" : NSStringFromSelector(@selector(call:arguments:done:)),
    @"watchStatus" : NSStringFromSelector(@selector(watchStatus)),
  };
}

- (instancetype)initWithLynxContext:(LynxContext *)context {
  if (self = [super init]) {
    _context = context;
  }
  return self;
}

// Lynx calls a module on its JavaScript thread, and the bridge lives on the main one. The answer is
// a value either way, `ok` or `error`, so `done` is called exactly once.
- (void)call:(NSString *)method arguments:(NSDictionary *)arguments done:(LynxCallbackBlock)done {
  dispatch_async(dispatch_get_main_queue(), ^{
    [IDZBridge.shared callMethod:method
                       arguments:arguments
                      completion:^(NSDictionary<NSString *, id> *answer) {
                        done(answer);
                      }];
  });
}

- (void)watchStatus {
  __weak LynxContext *context = _context;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_watch != nil) return;
    self->_watch = [IDZBridge.shared watchStatus:^(NSDictionary<NSString *, id> *status) {
      [context sendGlobalEvent:IdenzyStatusEvent withParams:@[ status ]];
    }];
  });
}

- (void)destroy {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_watch == nil) return;
    [IDZBridge.shared stopWatching:self->_watch];
    self->_watch = nil;
  });
}

@end
