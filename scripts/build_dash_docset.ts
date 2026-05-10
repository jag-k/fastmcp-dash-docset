#!/usr/bin/env bun

import { evaluate } from "@mdx-js/mdx";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMdxComponents, type RenderContext, type SearchEntry } from "../src/mdx-components.tsx";
import * as runtime from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import { codeToHtml } from "shiki";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Frontmatter = Record<string, string>;

type NavItem = {
  title: string;
  slug?: string;
  children: NavItem[];
};

type RenderedPage = {
  path: string;
  html: string;
  entries: SearchEntry[];
};

type Args = {
  docsDir: string;
  output: string;
  buildDir: string;
  assetCacheDir: string;
  name: string;
  bundleId: string;
  platformFamily: string;
  onlineBaseUrl: string;
  keepBuildDir: boolean;
};

type RemoteAsset = {
  url: string;
  localPath: string;
};

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_DOCS_DIR = join(ROOT, "docs");
const DEFAULT_OUTPUT = join(ROOT, "dist", "FastMCP.docset");
const DEFAULT_BUILD_DIR = join(ROOT, "dist", "dash-docset-build");
const DEFAULT_ASSET_CACHE_DIR = join(ROOT, ".cache", "assets");
const EXCLUDED_PREFIXES = ["v2/"];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    docsDir: DEFAULT_DOCS_DIR,
    output: DEFAULT_OUTPUT,
    buildDir: DEFAULT_BUILD_DIR,
    assetCacheDir: DEFAULT_ASSET_CACHE_DIR,
    name: "FastMCP",
    bundleId: "com.gofastmcp.docs",
    platformFamily: "fastmcp",
    onlineBaseUrl: "https://gofastmcp.com",
    keepBuildDir: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keep-build-dir") {
      args.keepBuildDir = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`Missing value for ${arg}`);
    i += 1;
    if (arg === "--docs-dir") args.docsDir = value;
    else if (arg === "--output") args.output = value;
    else if (arg === "--build-dir") args.buildDir = value;
    else if (arg === "--asset-cache-dir") args.assetCacheDir = value;
    else if (arg === "--name") args.name = value;
    else if (arg === "--bundle-id") args.bundleId = value;
    else if (arg === "--platform-family") args.platformFamily = value;
    else if (arg === "--online-base-url") args.onlineBaseUrl = value;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    ...args,
    docsDir: resolve(args.docsDir),
    output: resolve(args.output),
    buildDir: resolve(args.buildDir),
    assetCacheDir: resolve(args.assetCacheDir),
  };
}

async function readJson(path: string): Promise<JsonValue> {
  return JSON.parse(await readFile(path, "utf8")) as JsonValue;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExcludedSlug(slug: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

async function buildNavigation(docsDir: string): Promise<NavItem[]> {
  const config = await readJson(join(docsDir, "docs.json"));
  if (!isRecord(config)) return [];
  return navItemsFromValue(config.navigation, docsDir);
}

async function navItemsFromValue(
  value: JsonValue | undefined,
  docsDir: string,
): Promise<NavItem[]> {
  if (typeof value === "string") {
    if (isExcludedSlug(value)) return [];
    return [{ title: await pageTitle(docsDir, value), slug: value, children: [] }];
  }
  if (Array.isArray(value)) {
    const items: NavItem[] = [];
    for (const child of value) items.push(...(await navItemsFromValue(child, docsDir)));
    return items;
  }
  if (!isRecord(value)) return [];

  const ref = value.$ref;
  if (typeof ref === "string") {
    if (ref === "./v2-navigation.json") return [];
    return navItemsFromValue(
      await readJson(join(docsDir, ref.replace(/^\.\//, ""))),
      docsDir,
    );
  }
  if (typeof value.version === "string" && value.version.startsWith("v2")) return [];

  const pages = value.pages;
  if (typeof pages === "string" && isExcludedSlug(pages)) return [];

  const children: NavItem[] = [];
  for (const key of ["versions", "dropdowns", "groups", "anchors", "pages"]) {
    children.push(...(await navItemsFromValue(value[key], docsDir)));
  }

  const title = firstString(value.version, value.dropdown, value.group, value.anchor);
  if (title && children.length > 0) return [{ title, children }];
  return children;
}

function firstString(...values: (JsonValue | undefined)[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

async function pageTitle(docsDir: string, slug: string): Promise<string> {
  const sourcePath = join(docsDir, `${slug}.mdx`);
  if (!existsSync(sourcePath)) return titleFromSlug(slug);
  const { frontmatter } = splitFrontmatter(await readFile(sourcePath, "utf8"));
  return frontmatter.sidebarTitle || frontmatter.title || titleFromSlug(slug);
}

function splitFrontmatter(source: string): { frontmatter: Frontmatter; body: string } {
  if (!source.startsWith("---\n")) return { frontmatter: {}, body: source };
  const end = source.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: {}, body: source };

  const frontmatter: Frontmatter = {};
  for (const line of source.slice(4, end).split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match?.[1] && match[2] !== undefined) {
      frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body: source.slice(end + 5) };
}

function titleFromSlug(slug: string): string {
  return slug
    .split("/")
    .at(-1)!
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function collectPageSlugs(items: NavItem[]): string[] {
  const slugs: string[] = [];
  for (const item of items) {
    if (item.slug) slugs.push(item.slug);
    slugs.push(...collectPageSlugs(item.children));
  }
  return [...new Set(slugs)];
}

function breadcrumbTitle(items: NavItem[], slug: string): string | undefined {
  const breadcrumb = findBreadcrumb(items, slug);
  return breadcrumb?.join(" / ");
}

function findBreadcrumb(
  items: NavItem[],
  slug: string,
  parents: string[] = [],
): string[] | undefined {
  for (const item of items) {
    const nextParents = shouldFlattenSidebarItem(item.title) ? parents : [...parents, item.title];
    if (item.slug === slug) return nextParents;
    const childBreadcrumb = findBreadcrumb(item.children, slug, nextParents);
    if (childBreadcrumb) return childBreadcrumb;
  }
  return undefined;
}

async function buildDocset(args: Args): Promise<void> {
  log(`Starting docset build`);
  log(`Docs directory: ${args.docsDir}`);
  log(`Output docset: ${args.output}`);
  log(`Asset cache: ${args.assetCacheDir}`);
  const navigation = await buildNavigation(args.docsDir);
  const slugs = collectPageSlugs(navigation);
  log(`Discovered ${slugs.length} navigable pages`);
  const docsetDir = args.output;
  const resourcesDir = join(docsetDir, "Contents", "Resources");
  const documentsDir = join(resourcesDir, "Documents");

  log(`Preparing output directory`);
  await rm(docsetDir, { force: true, recursive: true });
  await mkdir(documentsDir, { recursive: true });
  log(`Copying static assets`);
  await copyStaticAssets(args.docsDir, documentsDir);
  log(`Localizing remote CSS and JS in copied HTML files`);
  await localizeCopiedHtmlAssets(documentsDir, args.assetCacheDir);
  log(`Prefetching referenced media assets`);
  const missingMedia = await prefetchReferencedMedia(
    args.docsDir,
    documentsDir,
    slugs,
    args.onlineBaseUrl,
    args.assetCacheDir,
  );
  log(`Media prefetch complete; ${missingMedia.size} assets will remain remote`);

  const entries: SearchEntry[] = [];
  let pageCount = 0;
  for (const [index, slug] of slugs.entries()) {
    const sourcePath = join(args.docsDir, `${slug}.mdx`);
    if (!existsSync(sourcePath)) continue;
    log(`Rendering page ${index + 1}/${slugs.length}: ${slug}`);
    let page: RenderedPage;
    try {
      page = await renderPage(
        sourcePath,
        slug,
        navigation,
        args.name,
        args.onlineBaseUrl,
        missingMedia,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not render ${slug}: ${message}`);
    }
    entries.push(...page.entries);
    await writeOutputPage(documentsDir, page);
    pageCount += 1;
  }

  log(`Writing landing page`);
  await writeMainPage(documentsDir, args.name);
  log(`Writing stylesheet`);
  await writeStylesheet(documentsDir);
  log(`Writing Info.plist`);
  await writeInfoPlist(docsetDir, args);
  log(`Writing docset icons`);
  await writeDocsetIcon(args.docsDir, resourcesDir);
  log(`Writing Dash search index`);
  writeSearchIndex(resourcesDir, disambiguateEntries(entries));

  if (!args.keepBuildDir) {
    log(`Cleaning build directory: ${args.buildDir}`);
    await rm(args.buildDir, { force: true, recursive: true });
  }

  log(`Built ${docsetDir}`);
  log(`Rendered ${pageCount} MDX pages`);
  log(`Indexed ${entries.length} Dash entries`);
}

async function renderPage(
  sourcePath: string,
  slug: string,
  navigation: NavItem[],
  docsetName: string,
  onlineBaseUrl: string,
  missingMedia: Set<string>,
): Promise<RenderedPage> {
  const source = await readFile(sourcePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(source);
  const title = frontmatter.title || frontmatter.sidebarTitle || titleFromSlug(slug);
  const fullTitle = breadcrumbTitle(navigation, slug) ?? title;
  const outputPath = slugToHtmlPath(slug);
  const isSdkPage = slug.startsWith("python-sdk/");
  const moduleName = isSdkPage ? sdkModuleName(body) : null;
  const pageEntryName = moduleName ?? fullTitle;
  const context: RenderContext = {
    currentPath: outputPath,
    onlineBaseUrl,
    missingMedia,
    entries: [{ name: pageEntryName, type: isSdkPage ? "Module" : "Guide", path: outputPath }],
    anchors: new Map(),
    isSdkPage,
    sdkSection: null,
    suppressSectionEntries: false,
  };
  const content = await postProcessRenderedHtml(
    await renderMdx(body, context),
    outputPath,
    onlineBaseUrl,
    missingMedia,
  );
  const nav = renderNavigation(navigation, outputPath);
  const cssHref = htmlEscape(relativePathTo(outputPath, "docset.css"), true);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(fullTitle)} - ${htmlEscape(docsetName)}</title>
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>
  <aside class="docset-sidebar">
${nav}
  </aside>
  <main class="docset-content">
    <header class="docset-page-header">
      ${isSdkPage && moduleName ? dashAnchor("Module", moduleName) : ""}
      <h1>${htmlEscape(title)}</h1>
      ${frontmatter.description ? `<p>${htmlEscape(frontmatter.description)}</p>` : ""}
    </header>
${content}
  </main>
</body>
</html>
`;
  return { path: outputPath, html, entries: context.entries };
}

function sdkModuleName(body: string): string | null {
  const match = /^#\s+`([^`]+)`/m.exec(body);
  return match?.[1] ?? null;
}

function dashAnchor(type: string, name: string): string {
  const ref = `//apple_ref/cpp/${type}/${encodeURIComponent(name)}`;
  return `<a name="${htmlEscape(ref, true)}" class="dashAnchor"></a>`;
}

async function renderMdx(source: string, context: RenderContext): Promise<string> {
  const sanitized = stripTopLevelImports(context.isSdkPage ? normalizeSdkMdx(source) : source);
  const mod = await evaluate(sanitized, {
    ...runtime,
    baseUrl: import.meta.url,
    remarkPlugins: [remarkGfm, remarkCodeMeta],
  });
  const Content = mod.default;
  return renderToStaticMarkup(
    createElement(Content, { components: createMdxComponents(context) as never }),
  );
}

function normalizeSdkMdx(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];
  let inFence = false;
  let literalPending = false;
  let inLiteralBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inLiteralBlock) {
        result.push("```");
        inLiteralBlock = false;
      }
      result.push(line);
      inFence = !inFence;
      literalPending = false;
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    if (inLiteralBlock) {
      if (line.trim() === "") {
        result.push(line);
        continue;
      }
      if (/^( {4}|\t)/.test(line)) {
        result.push(line.replace(/^( {4}|\t)/, ""));
        continue;
      }
      result.push("```");
      inLiteralBlock = false;
    }

    if (literalPending) {
      if (line.trim() === "") {
        result.push(line);
        continue;
      }
      if (/^( {4}|\t)/.test(line)) {
        result.push("```python");
        result.push(line.replace(/^( {4}|\t)/, ""));
        inLiteralBlock = true;
        literalPending = false;
        continue;
      }
      literalPending = false;
    }

    if (line.trimEnd().endsWith("::")) {
      result.push(line.replace(/::\s*$/, ":"));
      literalPending = true;
      continue;
    }

    result.push(line);
  }

  if (inLiteralBlock) result.push("```");
  return escapeSdkMdxTextExpressions(result.join("\n"));
}

function escapeSdkMdxTextExpressions(source: string): string {
  const result: string[] = [];
  let inFence = false;

  for (const line of source.split("\n")) {
    if (line.trim().startsWith("```")) {
      result.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }

    result.push(
      line
        .split("`")
        .map((part, index) =>
          index % 2 === 0
            ? part.replace(/(?<!\\)\{/g, "\\{").replace(/(?<!\\)\}/g, "\\}")
            : part,
        )
        .join("`"),
    );
  }

  return result.join("\n");
}

function stripTopLevelImports(source: string): string {
  const lines = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n");
  const result: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) inFence = !inFence;
    if (!inFence && /^\s*(import|export)\s+/.test(line)) continue;
    result.push(line);
  }
  return result.join("\n");
}

function remarkCodeMeta() {
  return (tree: unknown) => {
    visitTree(tree, (node) => {
      if (!isRecordLike(node) || node.type !== "code" || typeof node.meta !== "string") {
        return;
      }
      const data = isRecordLike(node.data) ? node.data : {};
      const hProperties = isRecordLike(data.hProperties) ? data.hProperties : {};
      data.hProperties = { ...hProperties, "data-meta": node.meta };
      node.data = data;
    });
  };
}

function visitTree(node: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (!isRecordLike(node)) return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) visitTree(child, visitor);
    } else if (isRecordLike(value)) {
      visitTree(value, visitor);
    }
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeOutputPage(documentsDir: string, page: RenderedPage): Promise<void> {
  const path = join(documentsDir, page.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, page.html, "utf8");
}

function renderNavigation(items: NavItem[], currentPath: string): string {
  return `<nav class="docset-nav" aria-label="Documentation navigation">
${renderNavItems(items, currentPath, 0)}
</nav>`;
}

function renderNavItems(items: NavItem[], currentPath: string, depth: number): string {
  if (items.length === 0) return "";
  return `<ul>${renderNavListItems(items, currentPath, depth)}</ul>`;
}

function renderNavListItems(items: NavItem[], currentPath: string, depth: number): string {
  return items.map((item) => renderNavItem(item, currentPath, depth)).join("");
}

function renderNavItem(item: NavItem, currentPath: string, depth: number): string {
  if (!item.slug && shouldFlattenSidebarItem(item.title)) {
    return renderNavListItems(item.children, currentPath, depth);
  }

  const activeBranch = navItemContainsPath(item, currentPath);
  if (item.slug) {
    const href = relativePathTo(currentPath, slugToHtmlPath(item.slug));
    const active = navPathMatches(item.slug, currentPath) ? " active" : "";
    return `<li class="depth-${depth}"><a class="docset-nav-link${active}" href="${htmlEscape(href, true)}">${htmlEscape(item.title)}</a></li>`;
  }
  return `<li class="depth-${depth}"><details${activeBranch ? " open" : ""}><summary>${htmlEscape(item.title)}</summary>${renderNavItems(item.children, currentPath, depth + 1)}</details></li>`;
}

function shouldFlattenSidebarItem(title: string): boolean {
  return title === "v3" || title === "Documentation";
}

function navItemContainsPath(item: NavItem, currentPath: string): boolean {
  if (item.slug && navPathMatches(item.slug, currentPath)) return true;
  return item.children.some((child) => navItemContainsPath(child, currentPath));
}

function navPathMatches(slug: string, currentPath: string): boolean {
  return slugToHtmlPath(slug) === currentPath;
}

function slugToHtmlPath(slug: string): string {
  return `${slug.replace(/^\/|\/$/g, "")}/index.html`;
}

async function postProcessRenderedHtml(
  html: string,
  currentPath: string,
  onlineBaseUrl: string,
  missingMedia: Set<string>,
): Promise<string> {
  const withoutVideos = removeVideoTags(html);
  const localUrls = withoutVideos.replace(/\b(href|src)="\/([^"]*)"/g, (_match, attr: string, path: string) => {
    if (missingMedia.has(path)) {
      return `${attr}="${htmlEscape(`${onlineBaseUrl.replace(/\/$/, "")}/${path}`, true)}"`;
    }
    const target = extname(path) ? path : slugToHtmlPath(path);
    return `${attr}="${htmlEscape(relativePathTo(currentPath, target), true)}"`;
  });
  return highlightCodeBlocks(repairCalloutParagraphs(addExternalLinkTargets(localUrls, onlineBaseUrl)));
}

function addExternalLinkTargets(html: string, onlineBaseUrl: string): string {
  return html.replace(/<a\b([^>]*\bhref="(https?:\/\/[^"]+)"[^>]*)>/g, (match, attrs: string, href: string) => {
    if (isDocumentationUrl(href, onlineBaseUrl) || /\btarget=/.test(attrs)) return match;
    const rel = /\brel=/.test(attrs) ? "" : ' rel="noreferrer"';
    return `<a${attrs} target="_blank"${rel}>`;
  });
}

function isDocumentationUrl(href: string, onlineBaseUrl: string): boolean {
  try {
    const url = new URL(href);
    const docsUrl = new URL(onlineBaseUrl);
    return url.origin === docsUrl.origin;
  } catch {
    return false;
  }
}

function removeVideoTags(html: string): string {
  return html
    .replace(/<video\b[\s\S]*?<\/video>/g, "")
    .replace(/<link\b[^>]*\bas=["']video["'][^>]*>/g, "");
}

function repairCalloutParagraphs(html: string): string {
  return html.replace(
    /<p>\s*(<aside class="callout [\s\S]*?<\/aside>)\s*([\s\S]*?)<\/p>/g,
    (_match, callout: string, rest: string) => {
      const remaining = rest.trim();
      return remaining ? `${callout}<p>${remaining}</p>` : callout;
    },
  );
}

async function highlightCodeBlocks(html: string): Promise<string> {
  const codeBlockPattern =
    /<pre><code(?: class="language-([^"]+)")?(?: data-meta="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
  const replacements = [...html.matchAll(codeBlockPattern)].map(async (match) => {
    const lang = normalizeCodeLanguage(match[1] ?? "text");
    const title = codeBlockTitle(decodeHtml(match[2] ?? ""));
    const code = decodeHtml(match[3] ?? "");
    try {
      const highlighted = await codeToHtml(code, {
        lang,
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        defaultColor: "light",
      });
      return [match[0], renderHighlightedCodeBlock(highlighted, title)] as const;
    } catch {
      const highlighted = await codeToHtml(code, {
        lang: "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
        defaultColor: "light",
      });
      return [match[0], renderHighlightedCodeBlock(highlighted, title)] as const;
    }
  });

  let result = html;
  for (const [original, highlighted] of await Promise.all(replacements)) {
    result = result.replace(original, highlighted);
  }
  return result;
}

function renderHighlightedCodeBlock(highlighted: string, title: string): string {
  if (!title) return highlighted;
  return `<figure class="code-block"><figcaption>${htmlEscape(title)}</figcaption>${highlighted}</figure>`;
}

function codeBlockTitle(meta: string): string {
  const titleMatch = /title=(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(meta);
  if (titleMatch) return titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? "";
  return meta
    .replace(/theme=\{.*?\}/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[?expandable\]?/gi, "")
    .replace(/\bexpandable\b/gi, "")
    .trim();
}

function normalizeCodeLanguage(language: string): string {
  const lang = language.toLowerCase().replace(/[^\w+-]/g, "");
  if (lang === "py") return "python";
  if (lang === "sh" || lang === "shell") return "bash";
  if (lang === "yml") return "yaml";
  if (lang === "md") return "markdown";
  return lang || "text";
}

function relativePathTo(currentPath: string, targetPath: string): string {
  const prefix = "../".repeat(Math.max(0, currentPath.split("/").length - 1));
  return `${prefix}${targetPath}`;
}

async function writeMainPage(
  documentsDir: string,
  name: string,
): Promise<void> {
  const target = "getting-started/welcome/index.html";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${htmlEscape(target, true)}">
  <title>${htmlEscape(name)} Documentation</title>
  <link rel="stylesheet" href="docset.css">
</head>
<body>
  <main class="docset-content">
    <p>Redirecting to <a href="${htmlEscape(target, true)}">Welcome to FastMCP</a>.</p>
  </main>
</body>
</html>
`;
  await writeFile(join(documentsDir, "index.html"), html, "utf8");
}

async function copyStaticAssets(docsDir: string, documentsDir: string): Promise<void> {
  for (const dir of ["assets", "public", "apps/demos"]) {
    const source = join(docsDir, dir);
    if (!existsSync(source)) continue;
    log(`Copying ${dir}`);
    await cp(source, join(documentsDir, dir), { recursive: true });
  }
}

async function localizeCopiedHtmlAssets(documentsDir: string, assetCacheDir: string): Promise<void> {
  const htmlFiles = await htmlFilesIn(documentsDir);
  const downloaded = new Map<string, RemoteAsset | null>();
  let localizedCount = 0;

  for (const htmlPath of htmlFiles) {
    const absolutePath = join(documentsDir, htmlPath);
    const original = await readFile(absolutePath, "utf8");
    let html = original;
    const matches = [...original.matchAll(/\b(href|src)="(https?:\/\/[^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)];
    if (matches.length === 0) continue;

    log(`Localizing ${matches.length} remote CSS/JS assets in ${htmlPath}`);
    for (const match of matches) {
      const attr = match[1];
      const url = match[2];
      if (!attr || !url) continue;

      let asset = downloaded.get(url);
      if (asset === undefined) {
        asset = await downloadRemoteHtmlAsset(url, documentsDir, assetCacheDir);
        downloaded.set(url, asset);
      }
      if (!asset) continue;

      const relative = relativePathTo(htmlPath, asset.localPath);
      html = html.replace(`${attr}="${url}"`, `${attr}="${htmlEscape(relative, true)}"`);
      localizedCount += 1;
    }

    if (html !== original) await writeFile(absolutePath, html, "utf8");
  }

  log(`Localized ${localizedCount} remote CSS/JS references`);
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

async function downloadRemoteHtmlAsset(
  url: string,
  documentsDir: string,
  assetCacheDir: string,
): Promise<RemoteAsset | null> {
  const localPath = remoteAssetPath(url);
  const destination = join(documentsDir, localPath);
  if (existsSync(destination)) return { url, localPath };

  if (!(await copyCachedRemoteAsset(url, destination, assetCacheDir, "remote HTML asset"))) return null;
  log(`Saved remote HTML asset: ${localPath}`);
  return { url, localPath };
}

function remoteAssetPath(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/^\/+/, "");
  const querySuffix = url.search ? `-${slugify(url.search)}` : "";
  const extension = extname(path);
  const withoutExtension = extension ? path.slice(0, -extension.length) : path;
  return join("_remote", url.hostname, `${withoutExtension}${querySuffix}${extension}`);
}

async function prefetchReferencedMedia(
  docsDir: string,
  documentsDir: string,
  slugs: string[],
  onlineBaseUrl: string,
  assetCacheDir: string,
): Promise<Set<string>> {
  const references = new Set<string>();
  const missing = new Set<string>();
  for (const slug of slugs) {
    log(`Scanning media references in ${slug}`);
    const sourcePath = join(docsDir, `${slug}.mdx`);
    if (!existsSync(sourcePath)) continue;
    for (const reference of mediaReferences(await readFile(sourcePath, "utf8"))) {
      references.add(reference);
    }
  }

  log(`Found ${references.size} unique media references`);
  for (const reference of references) {
    const destination = join(documentsDir, reference);
    if (existsSync(destination)) continue;

    const url = `${onlineBaseUrl.replace(/\/$/, "")}/${reference}`;
    const copied = await copyCachedRemoteAsset(url, destination, assetCacheDir, "media asset");
    if (!copied) {
      missing.add(reference);
      continue;
    }
    log(`Saved media asset: ${reference}`);
  }

  return missing;
}

async function copyCachedRemoteAsset(
  url: string,
  destination: string,
  assetCacheDir: string,
  label: string,
): Promise<boolean> {
  const cachePath = join(assetCacheDir, remoteAssetPath(url));
  if (existsSync(cachePath)) {
    log(`Using cached ${label}: ${url}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(cachePath, destination);
    return true;
  }

  log(`Fetching ${label}: ${url}`);
  const response = await fetchWithTimeout(url);
  if (!response || !response.ok) {
    if (response) log(`Could not fetch ${label}: ${url} (${response.status})`);
    return false;
  }

  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, body);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
  log(`Cached ${label}: ${cachePath}`);
  return true;
}

function mediaReferences(source: string): string[] {
  const mediaPattern =
    /\b(?:src|img)=["']\/([^"']+\.(?:png|jpe?g|webp|gif|svg))["']/gi;
  const uncommented = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return [...uncommented.matchAll(mediaPattern)]
    .map((match) => match[1])
    .filter((reference): reference is string => {
      if (!reference) return false;
      return !isExcludedSlug(reference);
    });
}

async function writeStylesheet(documentsDir: string): Promise<void> {
  await writeFile(
    join(documentsDir, "docset.css"),
    `:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #111827;
  --muted: #4b5563;
  --border: #e5e7eb;
  --soft: #f8fafc;
  --accent: #2d00f7;
  --note-bg: #eff6ff;
  --note-border: #93c5fd;
  --tip-bg: #ecfdf5;
  --tip-border: #86efac;
  --warning-bg: #fffbeb;
  --warning-border: #f59e0b;
  --info-bg: #f5f5f5;
  --info-border: #d4d4d4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --fg: #e5e7eb;
    --muted: #9ca3af;
    --border: #334155;
    --soft: #1e293b;
    --accent: #93c5fd;
    --note-bg: #172554;
    --note-border: #2563eb;
    --tip-bg: #052e16;
    --tip-border: #16a34a;
    --warning-bg: #451a03;
    --warning-border: #d97706;
    --info-bg: #171717;
    --info-border: #525252;
  }
}

* { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--fg);
  display: grid;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  margin: 0;
}
a { color: var(--accent); }
code {
  background: var(--soft);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.3em;
}
pre code {
  background: transparent;
  border: 0;
  padding: 0;
}
pre {
  overflow: auto;
}
.shiki {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}
.code-block {
  margin: 18px 0;
}
.code-block figcaption {
  background: var(--soft);
  border: 1px solid var(--border);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  padding: 8px 12px;
}
.code-block .shiki {
  border-radius: 0 0 12px 12px;
  margin-top: 0;
}
.shiki code {
  background: transparent;
  border: 0;
}
@media (prefers-color-scheme: dark) {
  .shiki,
  .shiki span {
    background-color: var(--shiki-dark-bg) !important;
    color: var(--shiki-dark) !important;
  }
}
.docset-sidebar {
  border-right: 1px solid var(--border);
  height: 100vh;
  overflow: auto;
  padding: 24px;
  position: sticky;
  top: 0;
}
.docset-content {
  padding: 40px min(6vw, 72px) 80px;
  width: 100%;
}
.docset-nav-title {
  font-weight: 700;
  margin-bottom: 12px;
}
.docset-nav ul {
  list-style: none;
  margin: 0;
  padding-left: 14px;
}
.docset-nav > ul { padding-left: 0; }
.docset-nav summary {
  cursor: pointer;
  font-weight: 600;
  margin-top: 8px;
}
.docset-nav-link {
  display: block;
  padding: 2px 0;
  text-decoration: none;
}
.docset-nav-link.active {
  font-weight: 700;
}
.docset-page-header {
  border-bottom: 1px solid var(--border);
  margin-bottom: 32px;
}
.docset-content img,
.docset-content video {
  border-radius: 16px;
  display: block;
  height: auto;
  margin: 18px 0;
  max-width: 100%;
}
.card-img {
  margin-top: 0;
  width: 100%;
}
.muted,
.field-meta {
  color: var(--muted);
}
.callout,
.card,
.param-field,
.expandable,
.frame {
  border: 1px solid var(--border);
  border-radius: 12px;
  margin: 18px 0;
  padding: 16px;
}
.callout {
  align-items: flex-start;
  background: var(--soft);
  display: flex;
  gap: 12px;
}
.callout-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 20px;
  height: 24px;
  justify-content: center;
  margin-top: 1px;
  width: 20px;
}
.callout-icon svg {
  display: block;
}
.callout-body > :first-child {
  margin-top: 0;
}
.callout-body > :last-child {
  margin-bottom: 0;
}
.callout.note {
  background: var(--note-bg);
  border-color: var(--note-border);
}
.callout.tip {
  background: var(--tip-bg);
  border-color: var(--tip-border);
}
.callout.warning {
  background: var(--warning-bg);
  border-color: var(--warning-border);
}
.callout.info {
  background: var(--info-bg);
  border-color: var(--info-border);
}
.update {
  display: flex;
  gap: 28px;
  margin: 34px 0;
}
.update-meta {
  color: var(--muted);
  flex: 0 0 150px;
}
.update-version {
  background: rgba(45, 0, 247, 0.12);
  border-radius: 8px;
  color: var(--accent);
  display: inline-block;
  font-weight: 700;
  margin-bottom: 14px;
  padding: 4px 10px;
}
.update-meta time {
  display: block;
}
.update-body {
  border-bottom: 1px solid var(--border);
  flex: 1 1 auto;
  min-width: 0;
  padding-bottom: 28px;
}
.update-body > :first-child {
  margin-top: 0;
}
.update-body > :last-child {
  margin-bottom: 0;
}
.update-body > p:first-child strong {
  color: var(--fg);
  font-size: 1.05rem;
}
.update-body > p:first-child strong a {
  color: inherit;
}
.update-body h3 {
  font-size: 1.1rem;
  margin-top: 28px;
}
.card-group {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin: 18px 0;
}
.card-link,
.tile {
  color: inherit;
  display: block;
  text-decoration: none;
}
.tile {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}
.tile span {
  color: var(--muted);
  display: block;
}
.version-badge,
.required {
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  display: inline-block;
  font-size: 0.85em;
  padding: 0.1em 0.5em;
}
.docset-tabs,
.docset-tab-panel,
.docset-steps {
  margin: 18px 0;
}
.docset-tab-panel {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.docset-iframe-demo {
  border: 0;
  border-radius: 12px;
  aspect-ratio: 16 / 10;
  display: block;
  height: auto !important;
  max-height: 70vh;
  max-width: 100%;
  min-height: 320px;
  width: 100%;
}
table {
  border-collapse: collapse;
  margin: 18px 0;
  width: 100%;
}
td,
th {
  border: 1px solid var(--border);
  padding: 8px 10px;
  text-align: left;
}
img,
video {
  max-width: 100%;
}
@media (max-width: 900px) {
  body { display: block; }
  .docset-sidebar { height: auto; position: static; }
  .update { display: block; }
}
`,
    "utf8",
  );
}

async function writeInfoPlist(docsetDir: string, args: Args): Promise<void> {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${xmlEscape(args.bundleId)}</string>
  <key>CFBundleName</key>
  <string>${xmlEscape(args.name)}</string>
  <key>DashDocSetFallbackURL</key>
  <string>${xmlEscape(args.onlineBaseUrl.replace(/\/$/, ""))}/</string>
  <key>DashDocSetFamily</key>
  <string>dashtoc</string>
  <key>DocSetPlatformFamily</key>
  <string>${xmlEscape(args.platformFamily)}</string>
  <key>dashIndexFilePath</key>
  <string>index.html</string>
  <key>isDashDocset</key>
  <true/>
</dict>
</plist>
`;
  await mkdir(join(docsetDir, "Contents"), { recursive: true });
  await writeFile(join(docsetDir, "Contents", "Info.plist"), plist, "utf8");
}

async function writeDocsetIcon(docsDir: string, resourcesDir: string): Promise<void> {
  const source = join(docsDir, "assets", "brand", "favicon-light.svg");
  if (!existsSync(source)) return;

  await copyFile(source, join(resourcesDir, "icon.svg"));

  const docsetDir = dirname(dirname(resourcesDir));
  await convertSvgIcon(source, join(docsetDir, "icon.png"), 32);
  await convertSvgIcon(source, join(docsetDir, "icon@2x.png"), 64);
}

async function convertSvgIcon(source: string, destination: string, size: number): Promise<void> {
  try {
    const process = Bun.spawn(["magick", source, "-resize", `${size}x${size}`, destination], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await process.exited;
    if (exitCode !== 0) {
      console.warn(`Could not create ${destination}`);
    }
  } catch {
    // SVG is still copied; PNG icons are a best-effort enhancement for Dash.
  }
}

function writeSearchIndex(resourcesDir: string, entries: SearchEntry[]): void {
  const dbPath = join(resourcesDir, "docSet.dsidx");
  const db = new Database(dbPath, { create: true });
  db.exec("DROP TABLE IF EXISTS searchIndex");
  db.exec("CREATE TABLE searchIndex(id INTEGER PRIMARY KEY, name TEXT, type TEXT, path TEXT)");
  db.exec("CREATE UNIQUE INDEX anchor ON searchIndex (name, type, path)");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO searchIndex(name, type, path) VALUES (?, ?, ?)",
  );
  const transaction = db.transaction((items: SearchEntry[]) => {
    for (const entry of items) insert.run(entry.name, entry.type, entry.path);
  });
  transaction(entries);
  db.close();
}

function disambiguateEntries(entries: SearchEntry[]): SearchEntry[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return entries.map((entry) => {
    const key = `${entry.type}:${entry.name}`;
    if ((counts.get(key) ?? 0) <= 1 || entry.type !== "Guide") return entry;
    return { ...entry, name: `${entry.name} (${entry.path.replace(/\/index\.html$/, "")})` };
  });
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\wа-яА-ЯёЁ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "section"
  );
}

function htmlEscape(value: string, quote = false): string {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return quote ? escaped.replace(/"/g, "&quot;") : escaped;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlEscape(value: string): string {
  return htmlEscape(value, true).replace(/'/g, "&apos;");
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Could not fetch ${url}: ${message}`);
    return null;
  }
}

function log(message: string): void {
  console.log(`[dash-docset] ${new Date().toISOString()} ${message}`);
}

try {
  await buildDocset(parseArgs(Bun.argv));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
