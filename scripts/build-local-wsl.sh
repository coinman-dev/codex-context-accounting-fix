#!/usr/bin/env bash
# Run in WSL (Windows cross-build), or an Ubuntu 22.04 chroot inside WSL (Linux).
set -euo pipefail
platform="${1:?Usage: build-local-wsl.sh linux|windows /path/to/patched/upstream}"
source_dir="${2:?Path to patched Codex checkout is required}"
project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.98.1
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-3}"
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
export CARGO_PROFILE_RELEASE_OPT_LEVEL=2
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
export CARGO_PROFILE_DEV_DEBUG=0
export RUST_MIN_STACK=8388608
set -a
source "$project/build/local-$platform.env"
set +a
cd "$source_dir/codex-rs"
case "$platform" in
  windows)
    export LIBSQLITE3_FLAGS=SQLITE_DISABLE_INTRINSIC
    cargo xwin build --release -p codex-cli --bin codex --target x86_64-pc-windows-msvc
    ;;
  linux)
    export CODEX_BWRAP_SHA256
    CODEX_BWRAP_SHA256="$(sha256sum "$project/build/vendor-0.160.0-linux/package/vendor/x86_64-unknown-linux-musl/codex-resources/bwrap" | cut -d ' ' -f1)"
    cargo build --release -p codex-cli --bin codex
    # Upstream disables its system-temp alias guard in debug builds. Release-mode
    # test binaries cannot initialize their tempfile CODEX_HOME under /tmp.
    cargo test --locked -p codex-core --test all -- all_turns_reasoning_without_header_does_not_compact_twice auto_compact_accounts_for_encrypted_reasoning auto_compact_body_after_prefix_still_caps_at_context_window
    cargo test --locked -p codex-chatgpt
    ;;
  *) echo "Unknown platform: $platform" >&2; exit 2 ;;
esac
