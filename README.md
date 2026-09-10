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

Installs the Playwright browsers and their system dependencies, then runs the
suite. The browsers are cached under an exact key built from the runner
architecture and the installed Playwright version, so the cache holds one entry
per version rather than one per run. A hit skips the download and only the
system packages are installed, since those live outside the cached directory.
The cache is saved before the suite runs, so a failing test does not throw away
the download. On failure `playwright-report/` and `test-results/` are uploaded
as an artifact.

The version comes from the installed `@playwright/test`, `playwright` or
`playwright-core` package, whichever resolves first. Every browser in the
config is installed; there is no browser input.

| Input               | Default                     | Description                                   |
| ------------------- | --------------------------- | --------------------------------------------- |
| `run`               | `pnpm exec playwright test` | Command that runs the suite                   |
| `working-directory` | `.`                         | Directory Playwright is resolved and run from |

| Output      | Description                              |
| ----------- | ---------------------------------------- |
| `version`   | The resolved Playwright version          |
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
