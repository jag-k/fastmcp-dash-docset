#!/usr/bin/env bun

import { resolve } from "node:path";
import { parseCliArgs, runCommand, stringArg } from "../src/lib.ts";

async function openDashUserContributionPr(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);
  const forkDir = resolve(stringArg(args, "fork-dir"));
  const version = stringArg(args, "version");
  const baseRepo = stringArg(args, "base-repo", "Kapeli/Dash-User-Contributions");
  const baseBranch = stringArg(args, "base", "master");
  const title = stringArg(args, "title", `Add FastMCP ${version} docset`);

  const branch = (await runCommand(["git", "branch", "--show-current"], forkDir)).trim();
  if (!branch) throw new Error("Could not determine fork branch");

  const owner = (await runCommand(["gh", "repo", "view", "--json", "owner", "--jq", ".owner.login"], forkDir)).trim();
  if (!owner) throw new Error("Could not determine fork owner");

  await runCommand(["git", "push", "-u", "origin", "HEAD"], forkDir);

  const head = `${owner}:${branch}`;
  const existing = (
    await runCommand(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        baseRepo,
        "--head",
        head,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url // \"\"",
      ],
      forkDir,
    )
  ).trim();

  if (existing) {
    console.log(existing);
    return;
  }

  const body = `## Summary
- Adds the FastMCP ${version} Dash docset.
- Generated from the FastMCP v${version} documentation.

## Validation
- Built with the dedicated fastmcp-dash-docset generator.
- Archive extracts to FastMCP.docset.
`;

  const url = await runCommand(
    [
      "gh",
      "pr",
      "create",
      "--repo",
      baseRepo,
      "--head",
      head,
      "--base",
      baseBranch,
      "--title",
      title,
      "--body",
      body,
    ],
    forkDir,
  );
  console.log(url.trim());
}

try {
  await openDashUserContributionPr(Bun.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
