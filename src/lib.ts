import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type CliArgs = Record<string, boolean | string>;

export type VersionRecord = {
  version: string;
  tag: string;
  archive: string;
};

export type ParsedVersion = {
  tag: string;
  version: string;
  major: number;
  minor: number;
  patch: number;
};

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) throw new Error(`Unexpected argument: ${arg ?? ""}`);

    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[name] = true;
      continue;
    }

    args[name] = next;
    index += 1;
  }
  return args;
}

export function stringArg(args: CliArgs, name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${name}`);
}

export function booleanArg(args: CliArgs, name: string): boolean {
  return args[name] === true;
}

export function parseStableVersionTag(value: string): ParsedVersion | null {
  const tag = value.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
  const normalized = tag.replace(/^v/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { tag, version: normalized, major, minor, patch };
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function readVersionRecords(path: string): Promise<VersionRecord[]> {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array`);

  return parsed.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("version" in item) ||
      !("tag" in item) ||
      !("archive" in item) ||
      typeof item.version !== "string" ||
      typeof item.tag !== "string" ||
      typeof item.archive !== "string"
    ) {
      throw new Error(`${path} contains an invalid version record`);
    }
    return { version: item.version, tag: item.tag, archive: item.archive };
  });
}

export async function archiveVersions(archivesDir: string): Promise<Set<string>> {
  if (!existsSync(archivesDir)) return new Set();

  const versions = new Set<string>();
  for (const entry of await readdir(archivesDir)) {
    const match = /^FastMCP-(\d+\.\d+\.\d+)\.tgz$/.exec(entry);
    if (match?.[1]) versions.add(match[1]);
  }
  return versions;
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function runCommand(command: string[], cwd?: string): Promise<string> {
  const process = Bun.spawn(command, {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with ${exitCode}\n${stderr.trim()}`);
  }
  return stdout;
}

export function archivePathForVersion(version: string): string {
  return `docsets/FastMCP-${version}.tgz`;
}

export function latestArchivePath(): string {
  return join("docsets", "FastMCP.tgz");
}
