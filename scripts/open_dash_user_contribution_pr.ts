#!/usr/bin/env bun

import { resolve } from "node:path";
import { parseCliArgs, runCommand, stringArg } from "../src/lib.ts";

async function openDashUserContributionPr(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const forkDir = resolve(stringArg(args, "fork-dir"));
  const versions = await versionsArg(args, forkDir);
  const version = stringArg(args, "version", await latestVersionArg(args, forkDir, versions));
  const baseRepo = stringArg(args, "base-repo", "Kapeli/Dash-User-Contributions");
  const baseBranch = stringArg(args, "base", "master");
  const title = stringArg(args, "title", titleForVersions(versions, version));
  const body = bodyForVersions(versions, version);

  const branch = (await runCommand(["git", "branch", "--show-current"], forkDir)).trim();
  if (!branch) throw new Error("Could not determine fork branch");

  await runCommand(["git", "push", "-u", "origin", "HEAD"], forkDir);

  const owner = await originOwner(forkDir);
  const head = `${owner}:${branch}`;
  const existing = await existingPullRequest(forkDir, baseRepo, baseBranch, head);

  if (existing) {
    const [number, url] = existing.split("\t");
    if (!number || !url) throw new Error(`Unexpected PR list output: ${existing}`);
    await runCommand(
      [
        "gh",
        "api",
        `repos/${baseRepo}/pulls/${number}`,
        "--method",
        "PATCH",
        "-f",
        `title=${title}`,
        "-f",
        `body=${body}`,
      ],
      forkDir,
    );
    console.log(url);
    return;
  }

  const url = (
    await runCommand(
      [
        "gh",
        "api",
        `repos/${baseRepo}/pulls`,
        "--method",
        "POST",
        "-f",
        `title=${title}`,
        "-f",
        `head=${head}`,
        "-f",
        `base=${baseBranch}`,
        "-f",
        `body=${body}`,
        "--jq",
        ".html_url",
      ],
      forkDir,
    )
  ).trim();
  console.log(url);
}

async function existingPullRequest(
  forkDir: string,
  baseRepo: string,
  baseBranch: string,
  head: string,
): Promise<string> {
  return (
    await runCommand(
      [
        "gh",
        "api",
        `repos/${baseRepo}/pulls`,
        "--method",
        "GET",
        "-f",
        `head=${head}`,
        "-f",
        `base=${baseBranch}`,
        "-f",
        "state=open",
        "--jq",
        "if length == 0 then \"\" else (.[0] | [.number, .html_url] | @tsv) end",
      ],
      forkDir,
    )
  ).trim();
}

async function versionsArg(args: ReturnType<typeof parseCliArgs>, forkDir: string): Promise<string[]> {
  const value = args.versions;
  if (typeof value !== "string") return addedVersionsFromLastCommit(forkDir);
  return value
    .split(",")
    .map((version) => version.trim())
    .filter(Boolean);
}

async function latestVersionArg(
  args: ReturnType<typeof parseCliArgs>,
  forkDir: string,
  versions: string[],
): Promise<string> {
  const value = args.version;
  if (typeof value === "string") return value;
  return latestVersionFromContribution(forkDir, versions);
}

async function addedVersionsFromLastCommit(forkDir: string): Promise<string[]> {
  const output = await runCommand(
    ["git", "diff", "--name-status", "HEAD^", "HEAD", "--", "docsets/FastMCP/versions"],
    forkDir,
  );
  const versions = new Set<string>();
  for (const line of output.trim().split("\n")) {
    const [status, path] = line.split(/\s+/, 2);
    if (status !== "A" || !path) continue;

    const match = /^docsets\/FastMCP\/versions\/(\d+\.\d+\.\d+)\/FastMCP\.tgz$/.exec(path);
    if (match?.[1]) versions.add(match[1]);
  }
  return [...versions].sort(compareVersions);
}

async function latestVersionFromContribution(forkDir: string, versions: string[]): Promise<string> {
  const docsetJson = await Bun.file(resolve(forkDir, "docsets/FastMCP/docset.json")).json();
  if (isVersionedDocsetJson(docsetJson)) return docsetJson.version;
  const fallback = versions.at(-1);
  if (fallback) return fallback;
  throw new Error("Could not determine FastMCP version from docsets/FastMCP/docset.json");
}

function isVersionedDocsetJson(value: unknown): value is { version: string } {
  return Boolean(value && typeof value === "object" && "version" in value && typeof value.version === "string");
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function originOwner(forkDir: string): Promise<string> {
  const origin = (await runCommand(["git", "remote", "get-url", "origin"], forkDir)).trim();
  const match = /github\.com[/:]([^/]+)\/[^/.]+(?:\.git)?$/.exec(origin);
  if (!match?.[1]) throw new Error(`Could not determine fork owner from origin remote: ${origin}`);
  return match[1];
}

function titleForVersions(versions: string[], latestVersion: string): string {
  if (versions.length === 0) return `Add FastMCP ${latestVersion} docset`;
  if (versions.length === 1) return `Add FastMCP ${versions[0]} docset`;
  return `Update FastMCP docset to ${latestVersion}`;
}

function bodyForVersions(versions: string[], latestVersion: string): string {
  const generatedVersions = versions.length > 0 ? versions : [latestVersion];
  const versionList = generatedVersions.map((version) => `   - FastMCP ${version}`).join("\n");

  return `## Summary
- Updates the FastMCP Dash docset contribution to ${latestVersion}.
- Adds versioned archives:
${versionList}

## Sources
- Generated from the FastMCP documentation for the versions listed above.

## Validation
- Built with the dedicated fastmcp-dash-docset generator.
- Archive extracts to FastMCP.docset.
`;
}

try {
  await openDashUserContributionPr(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
