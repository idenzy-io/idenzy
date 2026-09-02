export interface ConformanceContext<T> {
  /** A fresh instance of the implementation under test. */
  readonly subject: T;
  readonly name: string;
}

/**
 * Base for the shared test suite every member of a class family must pass
 * (PROJECT.md 7.4).
 *
 * The point is that a new OAuth provider, SMS adapter or MFA factor cannot be merged
 * until it satisfies the family's invariants. Without this, "the base class guarantees
 * X" is a claim about code review rather than a property of the build.
 *
 * A family author subclasses this and implements `defineCases`; a concrete
 * implementation runs it with one line.
 */
export abstract class ConformanceSuite<T> {
  abstract readonly familyName: string;

  /** Each case is a name and an assertion that throws on failure. */
  protected abstract defineCases(): readonly {
    name: string;
    run: (context: ConformanceContext<T>) => Promise<void>;
  }[];

  /**
   * Runs every case, collecting failures rather than stopping at the first, so a new
   * implementation sees everything it has to fix in one run.
   */
  async run(context: ConformanceContext<T>): Promise<readonly string[]> {
    const failures: string[] = [];
    for (const testCase of this.defineCases()) {
      try {
        await testCase.run(context);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${this.familyName}/${context.name}: ${testCase.name}: ${reason}`);
      }
    }
    return failures;
  }
}
