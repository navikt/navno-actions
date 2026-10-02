# navno-actions

Shared GitHub Actions for the navno team's repositories. Reference an action as
`navikt/navno-actions/<action>@v1`.

## setup-node-pnpm

Installs pnpm and Node at the versions in `package.json` (`packageManager`
and `engines.node`), enables the pnpm cache, sets up GitHub Packages auth and
runs `pnpm install`. Fails if `engines.node` is missing.

| Input             | Default | Description                                         |
| ----------------- | ------- | --------------------------------------------------- |
| `reader-token`    |         | Token for installing private packages               |
| `install`         | `true`  | Run `pnpm install`                                  |
| `frozen-lockfile` | `true`  | Pass `--frozen-lockfile` (dependabot needs `false`) |

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: navikt/navno-actions/setup-node-pnpm@v1
    with:
      reader-token: ${{ secrets.READER_TOKEN }}
  - run: pnpm run build
```

## setup-jvm

Installs a JDK and Gradle. Submits the Gradle dependency graph when building
the default branch.

| Input              | Default   | Description                                                                                        |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------- |
| `java-version`     | `21`      | JDK major version                                                                                  |
| `distribution`     | `temurin` | JDK distribution                                                                                   |
| `dependency-graph` | `auto`    | `auto`, `disabled`, `generate` or `generate-and-submit`. `auto` submits on the default branch only |

## write-env-file

Writes `KEY=VALUE` lines to a file byte for byte. Values never pass through a
shell. A line that is not `KEY=VALUE`, blank or a `#` comment fails the step.

| Input     | Default | Description                                           |
| --------- | ------- | ----------------------------------------------------- |
| `content` |         | The lines to write. Required                          |
| `path`    | `.env`  | File to write                                         |
| `copy-to` |         | Extra paths to copy the file to, whitespace-separated |

```yaml
- uses: navikt/navno-actions/write-env-file@v1
  with:
    content: |
      ENV=prod
      URL=https://example.test/$literal
    copy-to: server/.env
```

## find-scripts

Outputs `<name>=true|false` for each named `package.json` script, so a later
step can be skipped when the script is missing.

| Input     | Default | Description                                         |
| --------- | ------- | --------------------------------------------------- |
| `scripts` |         | Script names, whitespace-separated. Required        |
| `require` |         | Subset of `scripts` that fail the step when missing |

```yaml
- id: scripts
  uses: navikt/navno-actions/find-scripts@v1
  with:
    scripts: lint test
- if: steps.scripts.outputs.lint == 'true'
  run: pnpm run lint
```

## run-playwright

Installs the Playwright browsers and system dependencies, then runs the suite.
Browsers are cached per Playwright version (from `pnpm exec playwright --version`).
On failure `playwright-report/` and `test-results/` are uploaded as an artifact.

| Input               | Default                     | Description                                                                      |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `run`               | `pnpm exec playwright test` | Command that runs the suite                                                      |
| `working-directory` | `.`                         | Package to run from. Playwright must be installed there or at the workspace root |

| Output      | Description                              |
| ----------- | ---------------------------------------- |
| `version`   | The installed Playwright version         |
| `cache-hit` | Whether the browsers came from the cache |

```yaml
- uses: navikt/navno-actions/run-playwright@v1
  with:
    run: pnpm run test:e2e
```

## prune-dev-deps

Deletes `node_modules` directories and reinstalls with
`pnpm install --frozen-lockfile --prod`.

| Input    | Default        | Description                                                |
| -------- | -------------- | ---------------------------------------------------------- |
| `remove` | `node_modules` | Directories to delete, whitespace-separated, globs allowed |

## pnpm-deploy

Runs `pnpm --filter <package> deploy --prod <dir> --legacy` for each line,
producing symlink-free directories for a Docker image.

| Input      | Default | Description                                            |
| ---------- | ------- | ------------------------------------------------------ |
| `packages` |         | `<package> <output-dir>` pairs, one per line. Required |

```yaml
- uses: navikt/navno-actions/pnpm-deploy@v1
  with:
    packages: |
      ./packages/server nonsymlink/server
```

## find-release

Finds a release, the commit its tag points at and the image recorded in its
body, so a later job can deploy that image again, e.g. to roll back. It only
makes GET requests, so `contents: read` is enough.

An empty `tag` picks the release before the newest one. Only releases whose
tag starts with `tag-prefix` count; drafts are left out and pre-releases count
like any other. They are ordered by `published_at`, then by tag name. Older
releases of the newest release's commit are skipped, since deploying one would
deploy the same code again. A given `tag` must start with `tag-prefix`, use
letters, digits and `. _ / @ -` only and contain no `..`. It is checked before
any request, since it goes into API paths.

The image comes from the first line of the body that is exactly

```text
Deployed image: `<image>`
```

which navno-ci's `release.yml` writes from its `image` input. The image may
only contain letters, digits and `. _ / @ : -`, so it is safe in a shell and a
`,` or `=` can't add entries to nais-deploy's `var:`. It must end in
`@sha256:<digest>`: a tag such as `latest` moves, and only the digest says what
the release deployed.

When a lookup or the image fails, the step lists the ten newest releases in the
log and the job summary, with whether each has the line.

| Input        | Default               | Description                                                |
| ------------ | --------------------- | ---------------------------------------------------------- |
| `tag`        |                       | Release tag. Empty picks the release before the newest one |
| `tag-prefix` | `release/prod@`       | Only tags starting with this prefix are considered         |
| `token`      | `${{ github.token }}` | Token with `contents: read`                                |

| Output  | Description                                             |
| ------- | ------------------------------------------------------- |
| `tag`   | The release tag                                         |
| `sha`   | The commit the tag points at, 40 hex characters         |
| `image` | The digest-pinned image from the `Deployed image:` line |
| `url`   | The release page                                        |

```yaml
jobs:
  find:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      image: ${{ steps.release.outputs.image }}
      sha: ${{ steps.release.outputs.sha }}
    steps:
      - id: release
        uses: navikt/navno-actions/find-release@v1
        with:
          tag: ${{ inputs.release-tag }}
```

## check-node-version

Fails unless `package.json` declares `engines.node`. No inputs.
`setup-node-pnpm` already runs it.

## Development

Node 24 and pnpm.

```bash
pnpm install
pnpm run all   # format, lint, typecheck, test, build
```

Each TypeScript action is `<action>/src/main.ts`, bundled to
`<action>/dist/index.mjs`. The bundle is committed because the runner only runs what's present.
