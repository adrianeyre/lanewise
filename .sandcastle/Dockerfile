# The sandbox image an agent runs inside, to build and test Lanewise: a Tauri 2
# Desktop App with a Rust core and a React/TypeScript UI (ADR 0001).
#
# Four things Sandcastle needs and this file must keep: a non-root `agent` user
# (Claude Code refuses to run as root), `git` for the commits, `gh` for the
# issues, and `claude` on PATH.
#
# Node is pinned to 26 because the workspace declares `"node": ">=26"` and CI
# runs 26. `engines` is a warning rather than a wall, so a sandbox on an older
# Node installs happily and then fails somewhere further in — a much worse place
# to find out. If that line moves, move this one with it.
#
# Debian 13 (trixie) rather than 12 because its `git` is 2.47, and Lanewise
# requires 2.40 or later (ADR 0002). bookworm's is 2.39, one release short, and
# the core's `git` CLI runner is tested against the `git` in this image.
FROM node:26-trixie

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  curl \
  jq \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Fail the build rather than the first test that shells out to `git`, if a base
# image ever ships one older than the minimum ADR 0002 supports.
RUN version="$(git --version | cut -d' ' -f3)" \
  && dpkg --compare-versions "$version" ge 2.40 \
  || { echo "git $version is older than the 2.40 Lanewise requires (ADR 0002)" >&2; exit 1; }

# What `desktop/` links against on Linux, so the agent can build it and run its
# tests here: Tauri 2's webview (WebKitGTK 4.1) and GTK, librsvg for icons,
# OpenSSL, and pkg-config to find them. libxdo is what Tauri's menus use for
# keyboard accelerators on Linux, and `file` is what the AppImage bundler shells
# out to. Linux builds are for development and CI only (PRD §10.1). The base
# image already carries g++ and make.
RUN apt-get update && apt-get install -y --no-install-recommends \
  pkg-config \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  librsvg2-dev \
  libssl-dev \
  libxdo-dev \
  file \
  && rm -rf /var/lib/apt/lists/*

# A virtual display, so the WebKitGTK webview can run headless under
# `xvfb-run -a …` for the graph spike (#7), the performance targets (#16) and
# UI checks. There is no GPU in the sandbox: Mesa's software renderer is what
# WebKitGTK draws with. Rendering on WebView2 and WKWebView is still checked by
# hand on real machines (ADR 0001).
RUN apt-get update && apt-get install -y --no-install-recommends \
  xvfb \
  xauth \
  libgl1-mesa-dri \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI — the agent reads the issue it is working and comments on it.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# pnpm, at the version the workspace pins.
#
# Corepack is what reads `packageManager` from package.json at run time, so this
# keeps one source of truth for pnpm's version instead of pinning it twice. Node
# stopped shipping corepack in the distribution as of 25, so it is installed
# rather than merely enabled — `corepack enable` alone is `not found` here.
RUN npm install -g corepack@latest && corepack enable

# UID/GID alignment. `sandcastle docker build-image` defaults these to the host
# user's, so files the image writes and files the bind mount writes share an
# owner and no runtime chown is needed. A mismatch here is the cause of
# "permission denied" on a file the agent just created.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's `node` user to `agent` and align its UID/GID.
RUN groupmod -o -g $AGENT_GID node \
  && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:$PATH"

# Rust, for the Git core, the graph layout and both shells (ADR 0001): the
# stable toolchain and the components `pnpm lint` runs (rustfmt, and clippy with
# warnings denied). The base image already carries the C toolchain rustc links
# with.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable \
    --component clippy,rustfmt
ENV PATH="/home/agent/.cargo/bin:$PATH"

# Sandcastle bind-mounts the git worktree here and makes it the working
# directory at container start, so this has to be able to serve as the
# project root.
WORKDIR /home/agent/workspace

ENTRYPOINT ["sleep", "infinity"]
