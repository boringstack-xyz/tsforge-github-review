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

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
  with:
    fetch-depth: 0

- uses: boringstack-xyz/tsforge-github-review@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    base-ref: ${{ github.event.pull_request.base.ref }}
    # Optional — point at your own OpenAI-compatible endpoint. Omit to use
    # whatever TSForge is already configured for.
    model-url: https://your-model-endpoint/v1
    model-id: your-model-id
    # Optional — push a review-outcome event to a Loki push endpoint.
    loki-url: http://loki.example.internal:3100
```

The action must run *after* `actions/checkout` — it operates on the
already-checked-out working tree, it does not fetch the code itself.

## Inputs

| Input | Required | Description |
|---|---|---|
| `github-token` | yes | Token with `pull-requests: write` on the target repo. |
| `base-ref` | yes | The PR's base branch, to diff against. |
| `model-url` | no | Sets `TSFORGE_BASE_URL` for the `tsforge review` invocation. |
| `model-id` | no | Sets `TSFORGE_MODEL` for the `tsforge review` invocation. |
| `loki-url` | no | If set, pushes one outcome event per run to `<loki-url>/loki/api/v1/push`. Best-effort — never fails the action. |

## Runner requirements

This is a **composite action** — it runs as plain shell/`bun` steps directly
on your job's own runner, not inside a separate Docker container. That means
your runner needs `bun` (`>=1.4.0`) and the `tsforge` CLI already on `PATH`.
This is deliberate: it's built to run on a hardened, capability-dropped
sandbox where a Docker daemon isn't available (no Docker-in-Docker, no
`containerMode: kubernetes`) — the tradeoff is portability for isolation. If
you're setting this up yourself, bake Bun + a pinned `@agjs/tsforge` into
your own runner image; see
[`argocd-app-of-apps`'s reference `Dockerfile`](https://github.com/Programmer-Network/argocd-app-of-apps/blob/main/manifests/platform/arc-dreamdata-deep-reviewer/runner-image/Dockerfile)
for a working example (extends `ghcr.io/actions/actions-runner`).

## License

MIT
