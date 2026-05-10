# FastMCP Dash Docset

Dedicated generator for the FastMCP Dash docset.

## Scripts

- `bun run generate:missing -- --base-url https://<owner>.github.io/fastmcp-dash-docset`
- `bun run build:docset -- --docs-dir <path> --output dist/<version>/FastMCP.docset`
- `bun run discover:tags`
- `bun run fetch:docs -- --tag v3.0.0`
- `bun run package:docset -- --version 3.0.0 --docset dist/3.0.0/FastMCP.docset`
- `bun run generate:feed -- --base-url https://<owner>.github.io/fastmcp-dash-docset`
- `bun run update:dash-user-contribution -- --fork-dir <path>`
- `bun run open:dash-user-contribution-pr -- --fork-dir <path> --version 3.0.0`

The conversion stage only turns a local FastMCP `docs/` directory into a
`FastMCP.docset`. Fetching source docs, packaging archives, feed generation, and
Dash User Contributions automation are separate stages.

`generate:missing` is the normal end-to-end local generation entry point. It
stores fetched FastMCP source trees, transient build data, and shared downloaded
assets under `.cache/`, and builds each version into its own
`dist/<version>/FastMCP.docset` before packaging archives into `public/docsets/`.
Remote images, styles, and scripts are cached once under `.cache/assets/` and
copied into each versioned docset as needed.

`update:dash-user-contribution` syncs the latest `FastMCP.tgz` plus every
versioned archive listed in `public/versions.json` into the target fork. Use
`--latest-only` when preparing an upstream Dash User Contributions PR that should
only contain the latest submitted archive.
