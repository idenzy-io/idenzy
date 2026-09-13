import { Module } from "@nestjs/common";
import { CryptoModule } from "../crypto/crypto.module.js";
import { ProvidersController } from "./providers.controller.js";
import { ProvidersService } from "./providers-service.js";

/**
 * Imports CryptoModule because this is the first thing in the management API that writes an
 * encrypted column. The module existed and exported `FieldEncryptor`, and nothing had ever
 * imported it — so the binding was dead until a provider secret needed encrypting.
 */
@Module({
  imports: [CryptoModule],
  controllers: [ProvidersController],
  providers: [ProvidersService],
})
export class ProvidersModule {}
