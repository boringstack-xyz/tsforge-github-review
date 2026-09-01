# tsforge-github-review

A GitHub Action that runs [TSForge](https://tsforge.dev)'s agentic code
reviewer against a pull request and posts its findings as inline, resolvable
review comments — not a wall of text in one big comment.

Unlike a diff-only AI reviewer, TSForge's `tsforge review` actually reads the
repository: it navigates by symbol, follows references and definitions across
files, and checks types, the way a human reviewer does. This action wraps
that command for CI use with any OpenAI-compatible model, including a fully
local one.

## Usage

This ships as **two actions, meant to run in two separate jobs** — not one.
If your workflow checks out a PR's code in a job that also holds a
`pull-requests: write` token, that's a
["pwn request"](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/):
if anything in the checked-out tree executes during that job (a `bun
install` postinstall script, tsforge's own agentic tool calls, anything),
it runs with your write-scoped token in scope. Splitting the work avoids
this **by construction** — the job that checks out untrusted code holds no
token at all; the job that holds the token never checks out code.

```yaml
jobs:
  analyze:
    permissions:
      contents: read
      pull-requests: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          fetch-depth: 0

      # No github-token input — this action can't leak what it was never
      # given. Writes findings + diff to files in the workspace.
      - uses: boringstack-xyz/tsforge-github-review@v1
        with:
          base-ref: ${{ github.event.pull_request.base.ref }}
          # Optional — point at your own OpenAI-compatible endpoint. Omit
          # to use whatever TSForge is already configured for.
          model-url: https://your-model-endpoint/v1
          model-id: your-model-id

      - uses: actions/upload-artifact@v4
        with:
          name: tsforge-review
          path: |
            tsforge-review-findings.json
            tsforge-review-diff.txt

  post-review:
    needs: analyze
    permissions:
      pull-requests: write
    steps:
      # No checkout step at all — this job only reads the artifact and
      # calls GitHub's API.
      - uses: actions/download-artifact@v4
        with:
          name: tsforge-review

      - uses: boringstack-xyz/tsforge-github-review/post@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # Optional — push a review-outcome event to a Loki push endpoint.
          loki-url: http://loki.example.internal:3100
```

The `analyze` action must run _after_ `actions/checkout` — it operates on
the already-checked-out working tree, it does not fetch the code itself.
Both actions support being triggered by an `issue_comment` event (e.g. a
slash-command comment on a PR) as well as `pull_request`/
`pull_request_target` — they detect which shape fired and read the PR
number/URL accordingly either way, so no extra configuration is needed for
that case.

## Inputs

### `boringstack-xyz/tsforge-github-review@v1` (analyze)

Holds no GitHub token by design — see Usage above.

| Input       | Required | Description                                                    |
| ----------- | -------- | ---------------------------------------------------------------- |
| `base-ref`  | yes      | The PR's base branch, to diff against.                         |
| `model-url` | no       | Sets `TSFORGE_BASE_URL` for the `tsforge review` invocation.    |
| `model-id`  | no       | Sets `TSFORGE_MODEL` for the `tsforge review` invocation.       |

Writes `tsforge-review-findings.json` and `tsforge-review-diff.txt` to the
workspace — upload both as an artifact for the `post` job to consume.

### `boringstack-xyz/tsforge-github-review/post@v1` (post)

Never checks out code — the only one of the two that should hold
`pull-requests: write`.

| Input           | Required | Description                                                                                                      |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `github-token`  | yes      | Token with `pull-requests: write` on the target repo.                                                            |
| `findings-file` | no       | Path to the findings file. Default: `tsforge-review-findings.json` (the analyze action's default output name).  |
| `diff-file`     | no       | Path to the diff file. Default: `tsforge-review-diff.txt` (the analyze action's default output name).           |
| `loki-url`      | no       | If set, pushes one outcome event per run to `<loki-url>/loki/api/v1/push`. Best-effort — never fails the action. |

## Runner requirements

Both actions are **composite actions** — they run as plain shell/`bun` steps
directly on the job's own runner, not inside a separate Docker container.
That means the `analyze` job's runner needs `bun` (`>=1.4.0`) and the
`tsforge` CLI already on `PATH` (the `post` job needs neither — it's a
plain API call). This is deliberate: it's built to run on a hardened,
capability-dropped sandbox where a Docker daemon isn't available (no
Docker-in-Docker, no `containerMode: kubernetes`) — the tradeoff is
portability for isolation. If you're setting this up yourself, bake Bun +
a pinned `@agjs/tsforge` into your own runner image; see
[`runner-image/`](runner-image/) in this repo for a working example
(extends `ghcr.io/actions/actions-runner`), published publicly at
`ghcr.io/boringstack-xyz/tsforge-reviewer-runner`.

## License

MIT
