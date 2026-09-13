import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import { Global, Module } from "@nestjs/common";
import { BufferedActiveUserMeter } from "./buffered-active-user-meter.js";

/**
 * What the product is billed on (PROJECT.md 5.1).
 *
 * Global for the same reason `FlowsModule` is: every `AuthFlow` inherits the meter, so a flow
 * that could be constructed without one would be a sign-in method that does not appear on an
 * invoice. Bound to the abstract class rather than a symbol, because `ActiveUserMeter` owns the
 * definition of MAU and is therefore a real base and not a structural port.
 */
@Global()
@Module({
  providers: [{ provide: ActiveUserMeter, useClass: BufferedActiveUserMeter }],
  exports: [ActiveUserMeter],
})
export class UsageModule {}
