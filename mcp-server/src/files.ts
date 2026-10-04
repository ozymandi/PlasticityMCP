/**
 * File-safety rules shared by the tools that read or write files on behalf of Plasticity:
 * absolute paths only, checked extensions, no silent overwrite, and output published only
 * after Plasticity has written a complete file to a staging location.
 */
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

function checkPath(path: string, extensions: string[]): string {
  if (!isAbsolute(path)) throw new Error(`Path must be absolute: ${path}`);
  const full = resolve(path);
  if (!extensions.includes(extname(full).toLowerCase())) {
    throw new Error(`File must end in ${extensions.join(" or ")}: ${full}`);
  }
  return full;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Validate an existing input file and return its resolved path. */
export async function checkInput(path: string, extensions: string[]): Promise<string> {
  const full = checkPath(path, extensions);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new Error(`File not found: ${full}`);
  return full;
}

/** Validate an output path; refuses an existing file unless `overwrite`. */
export async function checkOutput(
  path: string,
  extensions: string[],
  overwrite: boolean,
): Promise<string> {
  const full = checkPath(path, extensions);
  if (!overwrite && (await exists(full))) {
    throw new Error(`File already exists: ${full} (pass overwrite: true to replace it)`);
  }
  return full;
}

/**
 * Let `write` produce a file at a staging path, `validate` it, then copy it to `output`.
 * A failed or invalid write never touches `output`. Returns the size in bytes.
 */
export async function writeStaged(
  output: string,
  overwrite: boolean,
  write: (stagingPath: string) => Promise<void>,
  validate: (stagingPath: string) => Promise<void>,
): Promise<number> {
  const staging = await mkdtemp(join(tmpdir(), "plasticity-mcp-"));
  const temporary = join(staging, `staged${extname(output)}`);
  try {
    await write(temporary);
    await validate(temporary);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(temporary, output, overwrite ? 0 : constants.COPYFILE_EXCL);
    return (await stat(output)).size;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
