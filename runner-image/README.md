# runner-image/README.md

Custom `actions-runner` image — adds Bun + a pinned `@agjs/tsforge` on top
of the stock `ghcr.io/actions/actions-runner:2.336.0` image, so a job can
run `tsforge review --json` (via this repo's [action.yml](../action.yml))
directly, with no network install step and no writes into the pod's own
filesystem at job time — useful for anyone running this action on a
hardened, read-only-root self-hosted runner.

Published to `ghcr.io/boringstack-xyz/tsforge-reviewer-runner`, public —
anyone can pull it, no credentials needed.

Rebuild + push via `.github/workflows/build-runner-image.yml` whenever
this Dockerfile or the pinned tsforge version changes. The image is
tagged `<actions-runner-version>-tsforge<tsforge-version>` (e.g.
`2.336.0-tsforge0.53.3`), encoding both things that define the image —
bump both together (the workflow's `VERSIONED_TAG` env var and the
Dockerfile's `bun install -g @agjs/tsforge@...` pin) in the same PR.

Consumers that pin this image directly in a pod spec (rather than
installing tsforge as a workflow step) should reference the exact
versioned tag, never a mutable one.
