import { Logger } from "@idenzy/core/logging/logger";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { Injectable } from "@nestjs/common";

const RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range";
const SUFFIX_LENGTH = 35;

/**
 * Have I Been Pwned's range API (PROJECT.md 4.5).
 *
 * Two things here are not obvious. `Add-Padding` asks the API to mix decoy entries into
 * every response so its size does not reveal how many real matches a prefix has; padding
 * entries carry a count of zero, so they are filtered out rather than treated as hits.
 *
 * And it fails open. A breach check is a warning, not an authorization decision, and an
 * outage at a third party is not a reason to stop people creating accounts. It is logged
 * so the gap is visible rather than silent.
 */
@Injectable()
export class HibpRangeChecker extends BreachedPasswordChecker {
  constructor(
    private readonly logger: Logger,
    private readonly timeoutMs: number = 1500,
  ) {
    super();
  }

  protected override async fetchRange(prefix: string): Promise<readonly string[]> {
    try {
      const response = await fetch(`${RANGE_ENDPOINT}/${prefix}`, {
        headers: { "Add-Padding": "true", "User-Agent": "idenzy-auth" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return this.unavailable(response.status);
      return parseRange(await response.text());
    } catch {
      return this.unavailable(null);
    }
  }

  private unavailable(status: number | null): readonly string[] {
    this.logger.warn("breach check unavailable, allowing the password", {
      statusCode: status ?? undefined,
      outcome: "fail_open",
    });
    return [];
  }
}

/** `SUFFIX:COUNT` per line. A zero count is padding, not a match. */
function parseRange(body: string): readonly string[] {
  const suffixes: string[] = [];
  for (const line of body.split("\n")) {
    const [suffix, count] = line.trim().split(":");
    if (suffix === undefined || suffix.length !== SUFFIX_LENGTH) continue;
    if (count === undefined || Number(count) <= 0) continue;
    suffixes.push(suffix);
  }
  return suffixes;
}
