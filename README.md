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
- `bun run open:dash-user-contribution-pr -- --fork-dir <path>`

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

## Dash User Contributions automation

The scheduled generator workflow can also update the FastMCP entry in
`jag-k/Dash-User-Contributions` and open or update a PR against
`Kapeli/Dash-User-Contributions`.

`.github/workflows/test-docsets.yml` runs on every push and pull request. It
typechecks the generator, validates every archive in `public/docsets/`, prepares
a temporary Dash User Contributions layout, and runs Kapeli's
`docsetcontrib --verify` against the generated FastMCP contribution.

### Workflow sequence

`.github/workflows/generate.yml` is the main workflow. It runs on the daily
schedule, `workflow_dispatch`, and the `fastmcp-release` repository dispatch
event. The workflow runs `generate:missing`, writes
`.cache/generation-result.json`, and exposes `has_new` as a job output:

- `has_new`: `true` when at least one missing FastMCP version was generated.

When `has_new` is `true`, the workflow commits `public/` and calls
`.github/workflows/dash-user-contribution.yml` as a reusable workflow.

`.github/workflows/dash-user-contribution.yml` can also be run manually from
the Actions tab. Manual runs are useful when `public/` already contains the
needed versions but the Dash User Contributions fork or PR needs to be repaired.
The workflow has no version inputs. It derives the PR title and body from the
commit it creates in `jag-k/Dash-User-Contributions`: the latest version comes
from `docsets/FastMCP/docset.json`, and new versions come from added
`docsets/FastMCP/versions/<version>/FastMCP.tgz` files.

The reusable/manual workflow checks out this generator repository and the
`jag-k/Dash-User-Contributions` fork. It then:

- updates the fork `master` from `Kapeli/Dash-User-Contributions/master`;
- recreates the local `fastmcp` branch directly from `upstream/master`;
- runs `update:dash-user-contribution` to sync `docsets/FastMCP`;
- preserves existing `FastMCP.tgz.txt` CDN placeholders and only adds
  missing version archives;
- commits the changed `FastMCP.tgz`, `docset.json`, `README.md`, and
  `versions/<version>/FastMCP.tgz` files;
- force-pushes only the `fastmcp` branch to the fork;
- runs `open:dash-user-contribution-pr` to create an upstream PR or update the
  title and body of the existing open PR.

### Required token

Create a repository secret named `DASH_USER_CONTRIBUTIONS_TOKEN` in this
repository. The token is used as `GH_TOKEN` for `gh` and as the checkout token
for `jag-k/Dash-User-Contributions`.

Use a GitHub personal access token that can push to
`jag-k/Dash-User-Contributions` and create PRs against the public upstream
repository. The simplest option is a classic PAT with the `public_repo` scope:

1. Open GitHub `Settings` -> `Developer settings` -> `Personal access tokens`
   -> `Tokens (classic)`, or use the prefilled
   [classic token form](https://github.com/settings/tokens/new?description=fastmcp-dash-user-contributions&scopes=public_repo).
2. Click `Generate new token` -> `Generate new token (classic)` if you opened
   the settings page manually.
3. Set a short expiration and a clear note, for example
   `fastmcp-dash-user-contributions`.
4. Select only the `public_repo` scope.
5. Generate the token and copy it.
6. Open this repository `Settings` -> `Secrets and variables` -> `Actions`, or
   use the
   [Actions secret form](https://github.com/jag-k/fastmcp-dash-docset/settings/secrets/actions/new).
7. Click `New repository secret` if you opened the settings page manually.
8. Set the name to `DASH_USER_CONTRIBUTIONS_TOKEN` and paste the token value.

After the secret is added, run `Generate FastMCP Docset` manually from the
Actions tab to verify the full chain before relying on the scheduled run.
