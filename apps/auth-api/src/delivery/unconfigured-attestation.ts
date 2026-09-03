import type { AttestationVerifier } from "@idenzy/domain/ports/attestation";
import { Injectable } from "@nestjs/common";

/**
 * The verifier a deployment has until reCAPTCHA or Turnstile is configured.
 *
 * It answers false for every token, which is the only safe answer: a verifier that
 * accepted what it cannot check would make `attestationRequired` a setting that reads as
 * protection and is not one, and the project believing it is protected is the one that
 * would be turned into a pumping target.
 *
 * That does make SMS unusable on a project whose policy requires attestation, which is
 * the point: turning the requirement off is a decision someone makes and can be seen
 * making, in a column, per project. The alternative is a global default that quietly
 * decides it for everyone.
 *
 * A real provider is a change to `DeliveryModule` and nothing else.
 */
@Injectable()
export class UnconfiguredAttestation implements AttestationVerifier {
  verify(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
