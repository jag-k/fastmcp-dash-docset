#!/usr/bin/env bun

import { copyFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { booleanArg, ensureDirectory, parseCliArgs, runCommand, stringArg } from "../src/lib.ts";

async function packageDocset(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const docset = resolve(stringArg(args, "docset", "dist/FastMCP.docset"));
  const version = stringArg(args, "version");
  const outputDir = resolve(stringArg(args, "output-dir", "public/docsets"));
  const updateLatest = !booleanArg(args, "no-latest");

  await ensureDirectory(outputDir);

  const archive = join(outputDir, `FastMCP-${version}.tgz`);
  await runCommand(
    ["tar", "--exclude=.DS_Store", "-czf", archive, basename(docset)],
    dirname(docset),
  );

  if (updateLatest) await copyFile(archive, join(outputDir, "FastMCP.tgz"));
  console.log(archive);
}

try {
  await packageDocset(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
