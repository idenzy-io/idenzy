import { MfaFactorAlreadyEnrolledError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { MfaFactor } from "@idenzy/domain/ports/mfa-factor";
import { AuthMethod, MfaFactorType } from "@idenzy/protocol/enums/auth";
import type { MfaProof } from "@idenzy/protocol/schemas/mfa";
import { describe, expect, it } from "vitest";
import { MfaFactorConformanceSuite, type MfaFactorHarness } from "../src/mfa-factor-conformance.js";

const context: FlowContext = {
  projectId: "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b",
  requestId: "req_conformance",
  ip: null,
  userAgent: null,
  deviceName: null,
  locale: null,
  attestation: null,
};

/**
 * A correct factor in memory: one unspent proof per user, crossed off when it is used.
 *
 * Deliberately not TOTP or a recovery code. A suite validated against the thing it was
 * written from proves only that the two agree, so the reference here is the simplest
 * implementation that satisfies the family's rules and nothing more.
 */
class ReferenceFactor extends MfaFactor {
  override readonly type = MfaFactorType.Totp;
  override readonly method = AuthMethod.Totp;
  override readonly demandsChallenge = true;
  protected readonly proofs = new Map<string, string>();

  enrolUser(userId: string, code: string): void {
    this.proofs.set(userId, code);
  }

  override enrolled(_context: FlowContext, userId: string): Promise<boolean> {
    return Promise.resolve(this.proofs.has(userId));
  }

  protected override check(
    _context: FlowContext,
    userId: string,
    proof: MfaProof,
  ): Promise<boolean> {
    if (proof.factor !== this.type) return Promise.resolve(false);
    if (this.proofs.get(userId) !== proof.code) return Promise.resolve(false);
    this.proofs.delete(userId);
    return Promise.resolve(true);
  }
}

/** Says "you have not enrolled that" out loud, which is the enumeration oracle. */
class TellsYouWhatYouHold extends ReferenceFactor {
  override async prove(context: FlowContext, userId: string, proof: MfaProof): Promise<AuthMethod> {
    if (!(await this.enrolled(context, userId))) {
      // Any code but the family's own is the bug: the caller can now tell the two apart.
      throw new MfaFactorAlreadyEnrolledError();
    }
    return super.prove(context, userId, proof);
  }
}

/** Checks without consuming, so the same code works for as long as it is displayed. */
class LeavesTheProofStanding extends ReferenceFactor {
  protected override check(
    _context: FlowContext,
    userId: string,
    proof: MfaProof,
  ): Promise<boolean> {
    return Promise.resolve(proof.factor === this.type && this.proofs.get(userId) === proof.code);
  }
}

/** Reports a method it did not run, so the session claims a factor that never happened. */
class ClaimsSomethingElse extends ReferenceFactor {
  override async prove(context: FlowContext, userId: string, proof: MfaProof): Promise<AuthMethod> {
    await super.prove(context, userId, proof);
    return AuthMethod.Password;
  }
}

/** Never notices it holds nothing, so `enrolled` cannot be trusted to shape a challenge. */
class AlwaysEnrolled extends ReferenceFactor {
  override enrolled(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Reads its own field off whatever it is handed, so another factor's proof gets through. */
class TakesAnybodysProof extends ReferenceFactor {
  protected override check(
    _context: FlowContext,
    userId: string,
    proof: MfaProof,
  ): Promise<boolean> {
    const code = "code" in proof ? proof.code : "";
    if (this.proofs.get(userId) !== code) return Promise.resolve(false);
    this.proofs.delete(userId);
    return Promise.resolve(true);
  }
}

function harnessFor(factor: ReferenceFactor): MfaFactorHarness {
  let next = 0;
  return {
    factor,
    context,
    enrol: () => {
      next += 1;
      const userId = `user-${next}`;
      const code = `${100000 + next}`;
      factor.enrolUser(userId, code);
      return Promise.resolve({ userId, proof: { factor: MfaFactorType.Totp, code } });
    },
    wrongProof: () => Promise.resolve({ factor: MfaFactorType.Totp, code: "999999" }),
    stranger: () => {
      next += 1;
      return Promise.resolve(`stranger-${next}`);
    },
  };
}

const suite = new MfaFactorConformanceSuite();

describe("the mfa factor conformance suite", () => {
  it("passes a correct factor", async () => {
    const failures = await suite.run({ subject: harnessFor(new ReferenceFactor()), name: "ref" });
    expect(failures).toEqual([]);
  });

  /** A suite that cannot fail proves nothing, so each broken factor is one here. */
  it.each([
    ["names what the user holds", new TellsYouWhatYouHold()],
    ["leaves a spent proof standing", new LeavesTheProofStanding()],
    ["claims a method it did not run", new ClaimsSomethingElse()],
    ["reports enrolment it does not have", new AlwaysEnrolled()],
    ["takes a proof meant for another factor", new TakesAnybodysProof()],
  ])("fails a factor that %s", async (name, factor) => {
    const failures = await suite.run({ subject: harnessFor(factor), name });
    expect(failures.length).toBeGreaterThan(0);
  });
});
