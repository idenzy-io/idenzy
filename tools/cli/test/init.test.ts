import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { MemoryFileSystem } from "../src/file-system.js";

const NEXT_PROJECT = { "app/package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }) };

function filesystem(seed: Readonly<Record<string, string>> = NEXT_PROJECT): MemoryFileSystem {
  return new MemoryFileSystem(seed);
}

describe("idenzy init", () => {
  it("detects the framework and scaffolds into the directory it was given", async () => {
    const files = filesystem();

    const result = await run(["init", "app", "--publishable-key", "pk_test_abc"], files);

    expect(result.code).toBe(0);
    expect(files.files.get("app/app/sign-in/page.tsx")).toContain("withEmailOtp");
    expect(files.files.get("app/lib/idenzy.ts")).toContain("new Idenzy");
    expect(files.files.get("app/.env.local")).toContain(
      "NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY=pk_test_abc",
    );
  });

  /**
   * The second run is the dangerous one. By then the sign-in page is the customer's, restyled,
   * and overwriting it is their work gone.
   */
  it("keeps a file that is already there, and says so", async () => {
    const files = filesystem({ ...NEXT_PROJECT, "app/app/sign-in/page.tsx": "// mine\n" });

    const result = await run(["init", "app"], files);

    expect(files.files.get("app/app/sign-in/page.tsx")).toBe("// mine\n");
    expect(result.lines.join("\n")).toContain("kept     app/sign-in/page.tsx");
  });

  it("overwrites only when asked", async () => {
    const files = filesystem({ ...NEXT_PROJECT, "app/app/sign-in/page.tsx": "// mine\n" });

    await run(["init", "app", "--force"], files);

    expect(files.files.get("app/app/sign-in/page.tsx")).toContain("withEmailOtp");
  });

  /** An env file is the file in a repository most likely to hold something unrecoverable. */
  it("adds missing environment keys and changes no value that is already set", async () => {
    const files = filesystem({
      ...NEXT_PROJECT,
      "app/.env.local": "NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY=pk_live_real\n",
    });

    await run(["init", "app", "--publishable-key", "pk_test_abc"], files);

    const env = files.files.get("app/.env.local") ?? "";
    expect(env).toContain("NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY=pk_live_real");
    expect(env).not.toContain("pk_test_abc");
    expect(env).toContain("NEXT_PUBLIC_IDENZY_API_URL=");
    expect(env).toContain("IDENZY_PROJECT_ID=");
  });

  /**
   * Refused on the prefix, before anything is written. A secret key scaffolded into a browser
   * bundle is published at the next build, and nothing after that unpublishes it.
   */
  it("refuses a secret key without writing anything", async () => {
    const files = filesystem();

    const result = await run(["init", "app", "--publishable-key", "sk_live_secret"], files);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("never leave a server");
    expect(files.files.size).toBe(1);
  });

  it("writes nothing on a dry run, and reports what it would have written", async () => {
    const files = filesystem();

    const result = await run(["init", "app", "--dry-run"], files);

    expect(files.files.size).toBe(1);
    expect(result.lines.join("\n")).toContain("created  app/sign-in/page.tsx");
  });

  it("says which frameworks it knows when it cannot tell", async () => {
    const files = filesystem({ "package.json": JSON.stringify({ dependencies: {} }) });

    const result = await run(["init"], files);

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("--framework");
  });

  it("scaffolds a framework named explicitly, whatever the manifest says", async () => {
    const files = filesystem({});

    const result = await run(["init", ".", "--framework", "next"], files);

    expect(result.code).toBe(0);
    expect(files.files.get("app/providers.tsx")).toContain("IdenzyProvider");
  });

  /** A placeholder is written so the scaffold is complete, and said out loud so it is noticed. */
  it("warns when it wrote a placeholder key", async () => {
    const files = filesystem();

    const result = await run(["init", "app"], files);

    expect(result.lines.join("\n")).toContain("placeholder");
  });

  it("prints usage and fails when given no command", async () => {
    const result = await run([], filesystem());

    expect(result.code).toBe(1);
    expect(result.lines.join("\n")).toContain("idenzy <command>");
  });
});
