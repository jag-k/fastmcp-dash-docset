#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  booleanArg,
  compareVersions,
  ensureDirectory,
  parseCliArgs,
  readVersionRecords,
  stringArg,
} from "../src/lib.ts";

type TemplateValues = Record<string, string>;

async function updateDashUserContribution(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const forkDir = resolve(stringArg(args, "fork-dir"));
  const targetDir = resolve(forkDir, stringArg(args, "target-dir", "docsets/FastMCP"));
  const templatesDir = resolve(stringArg(args, "templates-dir", "templates/dash-user-contribution"));
  const versionsFile = resolve(stringArg(args, "versions-file", "public/versions.json"));
  const archivesDir = resolve(stringArg(args, "archives-dir", "public/docsets"));
  const archive = resolve(stringArg(args, "archive", "public/docsets/FastMCP.tgz"));
  const records = await readVersionRecords(versionsFile);
  const version = targetVersion(args, records, versionsFile);
  const latestOnly = booleanArg(args, "latest-only");

  const values: TemplateValues = {
    ARCHIVE: "FastMCP.tgz",
    AUTHOR_LINK: stringArg(args, "author-link", "https://github.com/jlowin/fastmcp"),
    AUTHOR_NAME: stringArg(args, "author-name", "FastMCP maintainers"),
    SPECIFIC_VERSIONS: latestOnly ? "[]" : specificVersionsJson(records),
    VERSION: version,
  };

  await ensureDirectory(targetDir);
  await copyFile(archive, join(targetDir, "FastMCP.tgz"));
  await renderTemplate(join(templatesDir, "README.md"), join(targetDir, "README.md"), values);
  await renderTemplate(join(templatesDir, "docset.json.tpl"), join(targetDir, "docset.json"), values);
  if (!latestOnly) {
    await syncVersionArchives(records, archivesDir, targetDir);
  }

  await copyOptional(args, "icon", join(targetDir, "icon.png"));
  await copyOptional(args, "icon-2x", join(targetDir, "icon@2x.png"));
  console.log(targetDir);
}

async function renderTemplate(source: string, destination: string, values: TemplateValues): Promise<void> {
  let content = await readFile(source, "utf8");
  for (const [key, value] of Object.entries(values)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  await writeFile(destination, content, "utf8");
}

function targetVersion(
  args: ReturnType<typeof parseCliArgs>,
  records: Awaited<ReturnType<typeof readVersionRecords>>,
  versionsFile: string,
): string {
  const explicit = args.version;
  if (typeof explicit === "string") return explicit;

  const latest = records.sort((left, right) => compareVersions(right.version, left.version))[0];
  if (!latest) throw new Error(`No versions found in ${versionsFile}; run generate:missing first`);
  return latest.version;
}

async function syncVersionArchives(
  records: Awaited<ReturnType<typeof readVersionRecords>>,
  archivesDir: string,
  targetDir: string,
): Promise<void> {
  const versionsDir = join(targetDir, "versions");
  await rm(versionsDir, { force: true, recursive: true });

  for (const record of records) {
    const source = join(archivesDir, `FastMCP-${record.version}.tgz`);
    if (!existsSync(source)) throw new Error(`Missing generated archive: ${source}`);

    const destinationDir = join(versionsDir, record.version);
    await mkdir(destinationDir, { recursive: true });
    await copyFile(source, join(destinationDir, "FastMCP.tgz"));
  }
}

function specificVersionsJson(records: Awaited<ReturnType<typeof readVersionRecords>>): string {
  const versions = records
    .sort((left, right) => compareVersions(right.version, left.version))
    .map((record) => ({
      version: record.version,
      archive: `versions/${record.version}/FastMCP.tgz`,
    }));
  return JSON.stringify(versions, null, 2).replace(/\n/g, "\n  ");
}

async function copyOptional(
  args: ReturnType<typeof parseCliArgs>,
  name: string,
  destination: string,
): Promise<void> {
  const value = args[name];
  if (typeof value !== "string") return;
  const source = resolve(value);
  if (!existsSync(source)) throw new Error(`Missing --${name} file: ${source}`);
  await copyFile(source, destination);
}

try {
  await updateDashUserContribution(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
