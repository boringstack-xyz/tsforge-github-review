# runner-image/Dockerfile
#
# Extends the stock actions-runner image with Bun + @agjs/tsforge
# preinstalled, so a hardened, read-only-root self-hosted runner never needs
# to write into its own image at job time. Rebuild and re-push (via
# .github/workflows/build-runner-image.yml) whenever the pinned tsforge
# version changes.
FROM ghcr.io/actions/actions-runner:2.336.0
LABEL org.opencontainers.image.source=https://github.com/boringstack-xyz/tsforge-github-review

# actions-runner's default user is `runner` (uid 1001) — install as root,
# then drop back, so bun/tsforge land in a system path every uid can read
# (a caller's own pod securityContext can still force runAsNonRoot at
# runtime).
USER root

# BUN_INSTALL must be set for both the installer AND the later `bun install
# -g` — bun's global-install bin dir is $BUN_INSTALL/bin, defaulting to
# ~/.bun/bin (root's home) when unset. An unset BUN_INSTALL on the second
# RUN silently put tsforge under /root/.bun/bin, unreadable by the
# non-root `runner` user this image runs as.
ENV BUN_INSTALL=/usr/local

RUN curl -fsSL https://bun.sh/install | bash \
    && { chmod -R a+rX /usr/local/bin/bun 2>/dev/null || true; }

# Pin an exact tsforge version, not a floating range — a silent tsforge
# upgrade mid-review-cycle is exactly the kind of drift this image exists
# to avoid. Bump deliberately, in its own commit, when adopting a new
# tsforge release.
RUN /usr/local/bin/bun install -g @agjs/tsforge@0.53.6 \
    && { chmod -R a+rX /usr/local/bin/tsforge* 2>/dev/null || true; }

USER runner
