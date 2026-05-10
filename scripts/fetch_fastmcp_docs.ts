#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ensureDirectory, parseCliArgs, stringArg } from "../src/lib.ts";

async function fetchFastMcpDocs(argv: string[]): Promise<string> {
  const args = parseCliArgs(argv);
  const tag = stringArg(args, "tag");
  const repo = stringArg(args, "repo", "https://github.com/jlowin/fastmcp.git");
  const workDir = resolve(stringArg(args, "work-dir", ".cache"));
  const output = resolve(stringArg(args, "output", join(workDir, `fastmcp-${tag}`)));
  const timeoutMs = Number(stringArg(args, "timeout-ms", "300000"));

  await ensureDirectory(workDir);
  await rm(output, { force: true, recursive: true });
  console.log(`Fetching FastMCP ${tag} from ${repo}`);
  console.log(`Checkout directory: ${output}`);
  const archiveUrl = githubArchiveUrl(repo, tag);
  if (archiveUrl) {
    await fetchGitHubArchive(archiveUrl, tag, workDir, output, timeoutMs);
  } else {
    await fetchGitClone(repo, tag, output, timeoutMs);
  }

  const docsDir = join(output, "docs");
  if (!existsSync(docsDir)) throw new Error(`No docs directory found for ${tag}`);
  return docsDir;
}

async function fetchGitHubArchive(
  archiveUrl: string,
  tag: string,
  workDir: string,
  output: string,
  timeoutMs: number,
): Promise<void> {
  const archive = join(workDir, "downloads", `fastmcp-${safePathPart(tag)}.tar.gz`);
  await ensureDirectory(dirname(archive));
  await ensureDirectory(output);

  if (!existsSync(archive)) {
    console.log(`Downloading source archive: ${archiveUrl}`);
    await runStreamingCommand(
      [
        "curl",
        "--fail",
        "--location",
        "--show-error",
        "--progress-bar",
        "--connect-timeout",
        "30",
        "--max-time",
        String(Math.ceil(timeoutMs / 1000)),
        "--output",
        archive,
        archiveUrl,
      ],
      timeoutMs,
    );
  } else {
    console.log(`Using cached source archive: ${archive}`);
  }

  console.log(`Extracting source archive: ${archive}`);
  await runStreamingCommand(["tar", "-xzf", archive, "--strip-components", "1", "-C", output], timeoutMs);
}

async function fetchGitClone(
  repo: string,
  tag: string,
  output: string,
  timeoutMs: number,
): Promise<void> {
  await runStreamingCommand(
    ["git", "clone", "--progress", "--depth", "1", "--branch", tag, repo, output],
    timeoutMs,
  );
}

function githubArchiveUrl(repo: string, tag: string): string | null {
  const match = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(repo);
  if (!match?.[1] || !match[2]) return null;
  return `https://codeload.github.com/${match[1]}/${match[2]}/tar.gz/refs/tags/${tag}`;
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

async function runStreamingCommand(command: string[], timeoutMs: number): Promise<void> {
  const process = Bun.spawn(command, {
    env: {
      ...Bun.env,
      GIT_TERMINAL_PROMPT: "0",
    },
    stderr: "inherit",
    stdout: "inherit",
  });
  const timeout = setTimeout(() => process.kill(), timeoutMs);
  try {
    const exitCode = await process.exited;
    if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with ${exitCode}`);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  console.log(await fetchFastMcpDocs(Bun.argv));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
