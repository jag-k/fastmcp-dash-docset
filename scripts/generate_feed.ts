#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  archivePathForVersion,
  archiveVersions,
  compareVersions,
  ensureDirectory,
  latestArchivePath,
  parseCliArgs,
  readVersionRecords,
  stringArg,
  type VersionRecord,
} from "../src/lib.ts";

async function generateFeed(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const baseUrl = stringArg(args, "base-url", process.env.GITHUB_PAGES_BASE_URL);
  const versionsFile = resolve(stringArg(args, "versions-file", "public/versions.json"));
  const outputDir = resolve(stringArg(args, "output-dir", "public"));
  const archivesDir = resolve(stringArg(args, "archives-dir", "public/docsets"));

  const records = await collectVersionRecords(versionsFile, archivesDir);
  if (records.length === 0) throw new Error("No FastMCP archives found");

  await ensureDirectory(outputDir);
  await ensureDirectory(join(outputDir, "feeds"));

  const sorted = records.sort((left, right) => compareVersions(right.version, left.version));
  const latest = sorted[0];
  if (!latest) throw new Error("No latest version found");

  await writeFile(versionsFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  await writeFile(join(outputDir, "FastMCP.xml"), mainFeed(baseUrl, latest.version, sorted), "utf8");

  for (const record of sorted) {
    await writeFile(
      join(outputDir, "feeds", `FastMCP-${record.version}.xml`),
      singleVersionFeed(baseUrl, record.version, archivePathForVersion(record.version)),
      "utf8",
    );
  }
}

async function collectVersionRecords(
  versionsFile: string,
  archivesDir: string,
): Promise<VersionRecord[]> {
  const records = existsSync(versionsFile) ? await readVersionRecords(versionsFile) : [];
  const known = new Map(records.map((record) => [record.version, record]));

  for (const version of await archiveVersions(archivesDir)) {
    known.set(version, {
      version,
      tag: `v${version}`,
      archive: archivePathForVersion(version),
    });
  }

  return [...known.values()];
}

function mainFeed(baseUrl: string, latestVersion: string, records: VersionRecord[]): string {
  const versions = records
    .map((record) => `    <version><name>${xmlEscape(record.version)}</name></version>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<entry>
  <version>${xmlEscape(latestVersion)}</version>
  <url>${xmlEscape(urlFor(baseUrl, latestArchivePath()))}</url>
  <other-versions>
${versions}
  </other-versions>
</entry>
`;
}

function singleVersionFeed(baseUrl: string, version: string, archive: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<entry>
  <version>${xmlEscape(version)}</version>
  <url>${xmlEscape(urlFor(baseUrl, archive))}</url>
</entry>
`;
}

function urlFor(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

try {
  await generateFeed(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
