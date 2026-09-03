import { strict as assert } from "node:assert";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import { MfaFactorType } from "@idenzy/protocol/enums/auth";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import { ConformanceSuite } from "./conformance-suite.js";

/**
 * What an implementation supplies so the suite can exercise it.
 *
 * `enrol` returns a user who holds this factor and a proof that satisfies it once. Once
 * is the important word: several cases turn on what happens the second time, and a
 * factor whose proof were reusable would pass a weaker suite.
 */
export interface MfaFactorHarness {
  readonly factor: MfaFactor;
  readonly context: FlowContext;
  enrol(): Promise<{ userId: string; proof: MfaProof }>;
  /** A user of the same project holding nothing of this kind. */
  stranger(): Promise<string>;
  /**
   * A proof of this factor's kind that will not verify.
   *
   * Supplied rather than derived, because "wrong" is different per factor: a wrong TOTP
   * code is six other digits and a wrong assertion is one signed by another key. Deriving
   * it here would mean the suite knowing each factor's format, which is what it exists
   * not to do.
   */
  wrongProof(): Promise<MfaProof>;
}

/**
 * The suite every MFA factor must pass before it can be registered (PROJECT.md 7.4).
 *
 * The cases are the inherited guarantees rather than the arithmetic. Whether a TOTP
 * truncation is right is the crypto package's problem and has RFC vectors of its own;
 * what this asks is the family's questions, which are the ones a new factor gets wrong:
 * does an unenrolled user look different from a wrong code, does a proof stay spent, and
 * does the `amr` claim say what actually ran.
 */
export class MfaFactorConformanceSuite extends ConformanceSuite<MfaFactorHarness> {
  override readonly familyName = "MfaFactor";

  protected override defineCases() {
    return [
      {
        /**
         * The enumeration case, and the reason the base owns the throw. Everyone who
         * reaches a challenge already got past a first factor, so a distinguishable
         * refusal tells whoever holds a stolen password what else the account has.
         */
        name: "answers an unenrolled user exactly as it answers a wrong proof",
        run: async ({ subject }: { subject: MfaFactorHarness }) => {
          const { proof } = await subject.enrol();
          const stranger = await subject.stranger();

          const absent = await refusal(subject, stranger, proof);
          const wrong = await refusal(
            subject,
            (await subject.enrol()).userId,
            await subject.wrongProof(),
          );
          assert.equal(absent, ErrorCode.MfaFactorInvalid);
          assert.equal(wrong, ErrorCode.MfaFactorInvalid);
        },
      },
      {
        name: "reports enrolment only once there is something to prove",
        run: async ({ subject }: { subject: MfaFactorHarness }) => {
          const stranger = await subject.stranger();
          assert.equal(await subject.factor.enrolled(subject.context, stranger), false);

          const { userId } = await subject.enrol();
          assert.equal(await subject.factor.enrolled(subject.context, userId), true);
        },
      },
      {
        /** The claim has to describe what ran, not what the caller believed it asked for. */
        name: "returns its own method rather than anything the caller chose",
        run: async ({ subject }: { subject: MfaFactorHarness }) => {
          const { userId, proof } = await subject.enrol();
          const method = await subject.factor.prove(subject.context, userId, proof);
          assert.equal(method, subject.factor.method);
        },
      },
      {
        /**
         * A proof that is checked and not consumed is a proof the next request can
         * present again. For a code on a screen that is a replay inside its own window;
         * for one on a printed sheet it is a password that never expires.
         */
        name: "spends a proof, so the same one does not work twice",
        run: async ({ subject }: { subject: MfaFactorHarness }) => {
          const { userId, proof } = await subject.enrol();
          await subject.factor.prove(subject.context, userId, proof);

          assert.equal(await refusal(subject, userId, proof), ErrorCode.MfaFactorInvalid);
        },
      },
      {
        /**
         * The registry dispatches by factor, so this should be unreachable. It is a case
         * because a factor that read its own field off whatever it was handed would accept
         * a proof meant for another one the day the dispatch is wrong.
         */
        name: "refuses a proof meant for a different factor",
        run: async ({ subject }: { subject: MfaFactorHarness }) => {
          const { userId, proof } = await subject.enrol();
          // The valid proof under the wrong label, which is the only version of this that
          // catches anything: a factor reading its own field off whatever it is handed
          // would accept it, and one that refuses on the label first cannot.
          const foreign = relabelled(proof);

          assert.equal(await refusal(subject, userId, foreign), ErrorCode.MfaFactorInvalid);
        },
      },
    ];
  }
}

/**
 * The same proof under a different factor's name.
 *
 * A passkey assertion has nothing to relabel it as, so it gets a code proof, which any
 * correct factor refuses on the label alone.
 */
function relabelled(proof: MfaProof): MfaProof {
  if (!("code" in proof)) return { factor: MfaFactorType.Totp, code: "000000" };
  return proof.factor === MfaFactorType.Totp
    ? { factor: MfaFactorType.RecoveryCode, code: proof.code }
    : { factor: MfaFactorType.Totp, code: proof.code };
}

/** The code a refusal carried, or a marker that it did not refuse at all. */
async function refusal(
  subject: MfaFactorHarness,
  userId: string,
  proof: MfaProof,
): Promise<string> {
  try {
    await subject.factor.prove(subject.context, userId, proof);
    return "accepted";
  } catch (error: unknown) {
    return codeOf(error);
  }
}

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "unknown";
}
