#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseCliArgs, runCommand, stringArg } from "../src/lib.ts";

type SearchIndexRow = {
  name: string;
  path: string;
};

async function validateDocset(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const docset = resolve(stringArg(args, "docset", "dist/FastMCP.docset"));
  const archive = typeof args.archive === "string" ? resolve(args.archive) : undefined;
  const documentsDir = join(docset, "Contents", "Resources", "Documents");
  const indexPath = join(docset, "Contents", "Resources", "docSet.dsidx");

  assertExists(join(docset, "Contents", "Info.plist"));
  assertExists(indexPath);
  assertExists(join(documentsDir, "index.html"));

  validateSearchIndex(indexPath, documentsDir);
  await validateNoRemoteDemoAssets(documentsDir);
  if (archive) await validateArchive(archive);

  console.log(`Validated ${docset}`);
}

function assertExists(path: string): void {
  if (!existsSync(path)) throw new Error(`Missing required path: ${path}`);
}

function validateSearchIndex(indexPath: string, documentsDir: string): void {
  const db = new Database(indexPath, { readonly: true });
  try {
    const invalidNames = db
      .query<SearchIndexRow, []>(
        "SELECT name, path FROM searchIndex WHERE name IS NULL OR name = '' OR name LIKE '%' || char(10) || '%'",
      )
      .all();
    if (invalidNames.length > 0) {
      throw new Error(`searchIndex contains ${invalidNames.length} empty or multiline names`);
    }

    const rows = db.query<SearchIndexRow, []>("SELECT name, path FROM searchIndex").all();
    const missingPaths = rows.filter((row) => {
      const [path] = row.path.split("#", 1);
      return !path || !existsSync(join(documentsDir, path));
    });
    if (missingPaths.length > 0) {
      const sample = missingPaths
        .slice(0, 5)
        .map((row) => `${row.name} -> ${row.path}`)
        .join("\n");
      throw new Error(`searchIndex contains ${missingPaths.length} missing paths\n${sample}`);
    }

    console.log(`Validated ${rows.length} searchIndex rows`);
  } finally {
    db.close();
  }
}

async function validateNoRemoteDemoAssets(documentsDir: string): Promise<void> {
  const demoDir = join(documentsDir, "apps", "demos");
  if (!existsSync(demoDir)) return;

  const htmlFiles = await htmlFilesIn(demoDir);
  const remoteReferences: string[] = [];
  for (const relativePath of htmlFiles) {
    const content = await readFile(join(demoDir, relativePath), "utf8");
    if (/https:\/\/cdn\.jsdelivr\.net\/npm\/@prefecthq\/prefab-ui/.test(content)) {
      remoteReferences.push(relativePath);
    }
  }

  if (remoteReferences.length > 0) {
    throw new Error(`Demo HTML still contains remote Prefab assets: ${remoteReferences.join(", ")}`);
  }
  console.log(`Validated ${htmlFiles.length} copied demo HTML files`);
}

async function htmlFilesIn(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await htmlFilesIn(absolute, relative)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(relative);
    }
  }
  return files;
}

async function validateArchive(archive: string): Promise<void> {
  assertExists(archive);
  const output = await runCommand(["tar", "-tzf", archive]);
  const topLevel = new Set(output.split("\n").filter(Boolean).map((path) => path.split("/")[0]));
  if (topLevel.size !== 1 || !topLevel.has("FastMCP.docset")) {
    throw new Error(`Archive must extract to a single FastMCP.docset directory`);
  }
  console.log(`Validated archive ${archive}`);
}

try {
  await validateDocset(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
