import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The only thing this CLI does to a customer's machine, behind one port.
 *
 * A structural port with no shared logic, so an interface rather than an abstract base
 * (PROJECT.md 7.2.6). It exists so the tests scaffold into memory: a command that can only be
 * tested by writing into a temporary directory ends up tested twice, badly.
 */
export interface FileSystem {
  /** The file's contents, or null where there is no such file. */
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
}

/** The real one. Creates the directories a file needs on the way. */
export class NodeFileSystem implements FileSystem {
  async read(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  }

  async write(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

/** Scaffolds into a map, which is what the tests and `--dry-run` write to. */
export class MemoryFileSystem implements FileSystem {
  readonly files: Map<string, string>;

  constructor(seed: Readonly<Record<string, string>> = {}) {
    this.files = new Map(Object.entries(seed));
  }

  read(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }

  write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
    return Promise.resolve();
  }
}
