/**
 * Base for values whose existence proves their validity (PROJECT.md 7.2.9).
 *
 * Subclasses keep the constructor private and expose a static `parse`, so an instance
 * can only come from validated input. Nothing downstream re-checks.
 */
export abstract class ValueObject<T> {
  protected constructor(readonly value: T) {}

  equals(other: ValueObject<T>): boolean {
    return this.constructor === other.constructor && this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }

  toJSON(): T {
    return this.value;
  }
}
