#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  archiveVersions,
  compareVersions,
  parseCliArgs,
  parseStableVersionTag,
  readVersionRecords,
  runCommand,
  stringArg,
} from "../src/lib.ts";

type MissingTag = {
  tag: string;
  version: string;
};

async function discoverMissingTags(argv: string[]): Promise<MissingTag[]> {
  const args = parseCliArgs(argv);
  const repo = stringArg(args, "repo", "https://github.com/jlowin/fastmcp.git");
  const minMajor = Number(stringArg(args, "min-major", "3"));
  const versionsFile = resolve(stringArg(args, "versions-file", "public/versions.json"));
  const archivesDir = resolve(stringArg(args, "archives-dir", "public/docsets"));

  const existing = new Set((await readVersionRecords(versionsFile)).map((record) => record.version));
  for (const version of await archiveVersions(archivesDir)) existing.add(version);

  const output = await runCommand(["git", "ls-remote", "--tags", repo]);
  const tags = new Map<string, MissingTag>();
  for (const line of output.trim().split("\n")) {
    const ref = line.split(/\s+/)[1];
    if (!ref) continue;

    const parsed = parseStableVersionTag(ref);
    if (!parsed || parsed.major < minMajor || existing.has(parsed.version)) continue;
    tags.set(parsed.version, { tag: parsed.tag, version: parsed.version });
  }

  return [...tags.values()].sort((left, right) => compareVersions(left.version, right.version));
}

try {
  console.log(JSON.stringify(await discoverMissingTags(Bun.argv), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
