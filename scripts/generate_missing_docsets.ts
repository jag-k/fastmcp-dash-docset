#!/usr/bin/env bun

import { copyFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  archiveVersions,
  compareVersions,
  ensureDirectory,
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

type GenerationResult = {
  hasNew: boolean;
  generated: MissingTag[];
  latestVersion: string | null;
};

async function generateMissingDocsets(argv: string[]): Promise<GenerationResult> {
  const args = parseCliArgs(argv);
  const repo = stringArg(args, "repo", "https://github.com/jlowin/fastmcp.git");
  const minMajor = Number(stringArg(args, "min-major", "3"));
  const workDir = resolve(stringArg(args, "work-dir", ".cache"));
  const distDir = resolve(stringArg(args, "dist-dir", "dist"));
  const assetCacheDir = resolve(stringArg(args, "asset-cache-dir", join(workDir, "assets")));
  const publicDir = resolve(stringArg(args, "public-dir", "public"));
  const archivesDir = resolve(stringArg(args, "archives-dir", join(publicDir, "docsets")));
  const versionsFile = resolve(stringArg(args, "versions-file", join(publicDir, "versions.json")));
  const baseUrl = stringArg(args, "base-url", process.env.GITHUB_PAGES_BASE_URL);
  const resultFile = resolve(stringArg(args, "result-file", join(workDir, "generation-result.json")));

  await ensureDirectory(workDir);
  await ensureDirectory(archivesDir);

  const missing = await discoverMissingTags(repo, minMajor, versionsFile, archivesDir);
  if (missing.length === 0) {
    const latestVersion = await syncLatestArchive(archivesDir);
    const result = { hasNew: false, generated: [], latestVersion };
    await writeResult(resultFile, result);
    console.log("hasNew=false");
    console.log("No missing FastMCP stable tags found.");
    return result;
  }

  console.log(`hasNew=true`);
  console.log(`Generating ${missing.length} missing FastMCP docsets: ${missing.map((item) => item.version).join(", ")}`);

  const generated: MissingTag[] = [];
  for (const item of missing) {
    const checkoutDir = join(workDir, `fastmcp-${item.tag}`);
    const docset = join(distDir, item.version, "FastMCP.docset");
    const buildDir = join(workDir, "build", item.version);
    console.log(`\n=== ${item.tag} (${item.version}) ===`);
    console.log(`Source checkout: ${checkoutDir}`);
    console.log(`Versioned docset output: ${docset}`);
    console.log(`Shared asset cache: ${assetCacheDir}`);
    await runStreamingCommand([
      "bun",
      "run",
      "fetch:docs",
      "--",
      "--repo",
      repo,
      "--tag",
      item.tag,
      "--output",
      checkoutDir,
    ]);
    await runStreamingCommand([
      "bun",
      "run",
      "build:docset",
      "--",
      "--docs-dir",
      join(checkoutDir, "docs"),
      "--output",
      docset,
      "--build-dir",
      buildDir,
      "--asset-cache-dir",
      assetCacheDir,
    ]);
    await runStreamingCommand([
      "bun",
      "run",
      "package:docset",
      "--",
      "--version",
      item.version,
      "--docset",
      docset,
      "--output-dir",
      archivesDir,
      "--no-latest",
    ]);
    generated.push(item);
  }

  const latestVersion = await syncLatestArchive(archivesDir);
  await runStreamingCommand([
    "bun",
    "run",
    "generate:feed",
    "--",
    "--base-url",
    baseUrl,
    "--versions-file",
    versionsFile,
    "--output-dir",
    publicDir,
    "--archives-dir",
    archivesDir,
  ]);

  const result = { hasNew: true, generated, latestVersion };
  await writeResult(resultFile, result);
  console.log(`Generated ${generated.length} new docsets.`);
  console.log(`Latest FastMCP archive points to ${latestVersion ?? "none"}.`);
  console.log(`Result written to ${resultFile}`);
  return result;
}

async function discoverMissingTags(
  repo: string,
  minMajor: number,
  versionsFile: string,
  archivesDir: string,
): Promise<MissingTag[]> {
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

async function syncLatestArchive(archivesDir: string): Promise<string | null> {
  const versions = [...(await archiveVersions(archivesDir))].sort((left, right) =>
    compareVersions(right, left),
  );
  const latest = versions[0];
  if (!latest) return null;

  await copyFile(join(archivesDir, `FastMCP-${latest}.tgz`), join(archivesDir, "FastMCP.tgz"));
  return latest;
}

async function writeResult(path: string, result: GenerationResult): Promise<void> {
  await ensureDirectory(dirname(path));
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function runStreamingCommand(command: string[]): Promise<void> {
  const process = Bun.spawn(command, {
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with ${exitCode}`);
}

try {
  await generateMissingDocsets(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
