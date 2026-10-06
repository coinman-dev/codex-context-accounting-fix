[English](/README.md) | [Русский](/README.ru_RU.md)

# Codex context accounting fix

[![Codex 0.160.0](https://img.shields.io/badge/Codex-0.160.0-10A37F.svg)](#automatic-installation-windows-and-wsl2)
[![Windows | Ubuntu/WSL2](https://img.shields.io/badge/Windows%20%7C%20Ubuntu%2FWSL2-x64-0078D4.svg)](#installation)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

**codex-context-accounting-fix** fixes premature compaction in **Codex 0.159.2 and 0.160.0** on Windows and Ubuntu/WSL2. The **0.160.0 prerelease** provides rebuilt binaries and a PowerShell installer for Zed and the terminal. The fix prevents stored reasoning from being counted twice.

Only reproducible sources are committed here. Binaries are distributed through GitHub Releases; model catalogs, logs and account data are not published.

## Automatic installation: Windows and WSL2

Download and run the installer from [v0.160.0-reasoning.1](https://github.com/coinman-dev/codex-context-accounting-fix/releases/tag/v0.160.0-reasoning.1):

```powershell
Invoke-WebRequest -UseBasicParsing https://github.com/coinman-dev/codex-context-accounting-fix/releases/download/v0.160.0-reasoning.1/install.ps1 -OutFile .\install-codex-fix.ps1
powershell -ExecutionPolicy Bypass -File .\install-codex-fix.ps1
```

Run as your regular Windows user. Administrator rights, Python for Windows and a Rust toolchain are not required. Windows needs x64, PowerShell 5.1+, and Node.js 20+; the installer can use Zed's bundled Node.js. WSL2 needs x86_64, Python 3, Node.js 20+, glibc 2.35+, OpenSSL 3 and libcap (Ubuntu 22.04+). If Node.js is missing, start the Codex agent in Zed once or install Node.js in that OS.

The script downloads the matching release archives, verifies SHA-256 for the archives and their contents, stages both installations, and then switches the stock Zed `codex-acp` agent to the patched files. It discovers WSL2 distros with an existing Codex profile and skips Docker's service distros. It installs under `~/.codex/context-accounting-fix/`, adds a `codex` launcher to the user PATH, backs up affected files, and checks app-server startup and ACP startup where the adapter is installed. The checks create empty threads and send no model prompts. A startup failure triggers rollback of the prepared installations.

Existing context-window settings are preserved; increasing the window is a separate choice. After installation choose **⋯ → Reload Agent** in Zed when current work finishes. Open a new terminal to use the patched `codex`. An explicit executable path, shell alias/function, or a system PATH entry taking priority can still select another Codex; `Get-Command codex -All` / `type -a codex` shows which command your shell selects.

```powershell
.\install-codex-fix.ps1 -WindowsOnly          # Windows only
.\install-codex-fix.ps1 -WslOnly -Distro Ubuntu # One WSL2 distro
.\install-codex-fix.ps1 -SkipCli              # Connect Zed only
.\install-codex-fix.ps1 -SkipZed              # Install the terminal command only
.\install-codex-fix.ps1 -Check                # Verify the installed binaries
.\install-codex-fix.ps1 -Rollback             # Restore the previous installation
```

Rollback restores the previous files, including an earlier local fix. It stops if an affected file was edited after installation, so your edits are preserved. Existing official executables remain available at their original paths. Backups and transaction records are under `~/.codex/context-accounting-fix/transactions/` in each OS. For offline installation, download `release.json`, `install-helper.cjs`, `preload.cjs`, and the required platform ZIPs from the same release into one folder, then pass `-AssetDirectory C:\path\to\folder`.

The archives include the platform resources from the official 0.160.0 npm packages, verified against npm SHA-512, plus the patched CLI and its source patch. Windows SQL migrations are normalized to CRLF to match the official Windows database checksums. Linux is built on Ubuntu 22.04. The build workflow pins upstream commit `a956835d020762cb2b570053af06f643a11c0ecc` and verifies upstream V8 assets against the checked-in manifests.

## Why compact started too early

With `reasoning.context = all_turns` the server already includes stored reasoning in `input_tokens`. When a response had no `x-reasoning-included` header, Codex estimated the same reasoning a second time and started compact before the context was full.

In the chat that was investigated, the Zed indicator showed 737,658 tokens. Codex added an estimate of 313,149 tokens of earlier reasoning and 946 tokens of new tool results, which gave 1,051,753 against a limit of 1,050,000. See the [report of a similar bug](https://github.com/openai/codex/issues/39767).

## What the patch does

The patch decides how reasoning is counted from the request mode, keeps the previous response's flag until the check before a new turn has run, and recomputes it for the model of the actual request. The content of the history is not changed. For models where the server does not count earlier reasoning, the previous calculation is kept.

## Repository contents

| File | Purpose |
| --- | --- |
| [`install.ps1`](install.ps1) | Downloads and installs prerelease binaries on Windows and WSL2; supports checks and rollback |
| [`scripts/install-helper.cjs`](scripts/install-helper.cjs) | Verifies packages, edits Zed JSONC, and performs installation transactions |
| [`.github/workflows/build-prerelease.yml`](.github/workflows/build-prerelease.yml) | Builds Windows/Linux 0.160.0 and runs accounting regression tests |
| [`patches/codex-0.159.2-reasoning-accounting.patch`](patches/codex-0.159.2-reasoning-accounting.patch) | The patch for the Codex sources |
| [`bootstrap/preload.cjs`](bootstrap/preload.cjs) | Portable loader that points the stock `codex-acp` agent at the installed binary |
| [`scripts/install.py`](scripts/install.py) | Installer |
| [`scripts/enable.ps1`](scripts/enable.ps1) | Enables the fix in Zed |
| [`scripts/probe.cjs`](scripts/probe.cjs) | Startup check through the stock ACP adapter |
| [`scripts/fetch-vendor.py`](scripts/fetch-vendor.py) | Downloads the official package |
| [`scripts/prepare-windows-migrations.py`](scripts/prepare-windows-migrations.py) | Switches the line endings of the SQL migrations before a Windows build |
| [`scripts/replace-windows.py`](scripts/replace-windows.py) | Replaces the executable of an installed Windows build |
| [`scripts/create-catalog.py`](scripts/create-catalog.py) | Model catalog generator |

## Building

The automated 0.160.0 build is in the workflow above. The following commands describe the original local 0.159.2 build; the same patch applies to both versions.

Clone [OpenAI Codex](https://github.com/openai/codex) at tag `rust-v0.159.2` and apply the patch in the root of its sources:

```bash
git clone --depth 1 --branch rust-v0.159.2 https://github.com/openai/codex.git codex-0.159.2
cd codex-0.159.2
git apply /path/to/codex-context-accounting-fix/patches/codex-0.159.2-reasoning-accounting.patch
cd codex-rs
```

The patch also applies unchanged to tag `rust-v0.160.0`.

Use Rust 1.98.1, `just` and `cargo-nextest`. A Windows build also needs the `x86_64-pc-windows-msvc` target, `cargo-xwin`, Clang/LLD and CMake. The first Cargo run updates the local package versions in the `Cargo.lock` of the source tag; the dependencies stay pinned. The profile used for validation:

```bash
export RUSTUP_TOOLCHAIN=1.98.1
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
export CARGO_PROFILE_RELEASE_OPT_LEVEL=2
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
cargo build --release -p codex-cli --bin codex
# Before the Windows build, run scripts/prepare-windows-migrations.py
# from this repository with --codex-rs /path/to/codex-0.159.2/codex-rs.
cargo xwin build --release --locked -p codex-cli --bin codex --target x86_64-pc-windows-msvc
```

The results are `target/release/codex` for Ubuntu and `target/x86_64-pc-windows-msvc/release/codex.exe` for Windows. For a complete working set, copy the helper files of the official package of the same version next to them. `scripts/fetch-vendor.py --platform windows` and `--platform linux` download the official 0.159.2 npm packages and verify SHA-512. The download directory `build/` is excluded from Git.

### Windows and SQLite

The Windows package of Codex was built with CRLF in its SQL migrations, while sources checked out by Git on Ubuntu usually have LF. SQLx computes checksums from the exact bytes of the SQL. A Windows build made from LF sources therefore rejects an existing Windows SQLite database, even though the database itself is intact.

After the Linux build, switch the migrations to CRLF and only then build for Windows:

```bash
python scripts/prepare-windows-migrations.py --codex-rs /path/to/codex-0.159.2/codex-rs --mode crlf
```

Before building Linux again, switch back with `--mode lf`. The script changes line endings only in the six migration directories and makes Cargo rebuild the module that includes them. User SQLite databases do not need to be changed.

## Installation

Install separately in each OS:

```bash
python scripts/install.py --binary PATH_TO_BINARY --vendor-root PATH_TO_VENDOR --patch patches/codex-0.159.2-reasoning-accounting.patch --preload bootstrap/preload.cjs
```

The installer creates a separate version in `~/.codex/context-accounting-fix/`, verifies the hash of the executable and produces a launch option that is the same for both OSes. It does not replace the files of the official Codex.

After a successful installation in Windows and Ubuntu, run `scripts/enable.ps1` in PowerShell. The script checks the results of `scripts/probe.cjs` from both OSes and adds one environment variable to the **stock** `codex-acp` agent. A backup of `settings.json` is created next to it. For a Zed project that is already open, choose `⋯` in the chat panel → **Reload Agent** once the current task has finished. The editor does not need to be restarted. The model selection and the other Codex settings are kept.

If an earlier Windows build made from LF sources is already installed, replace only its executable:

```bash
python scripts/replace-windows.py --binary PATH_TO_NEW_codex.exe
```

The script checks the version and the checksums, keeps the previous file in the same folder, then updates `current.json`. Run the ACP check and enable the Zed setting after the replacement has succeeded.

## Context window size

The accounting fix does not change the window and works with the default settings. A larger window is a separate, optional choice.

The 1,050,000-token window that OpenAI lists for the GPT-6 and GPT-5.6 models is split between input and output: the [model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) gives a maximum input of 922,000 tokens and a maximum output of 128,000. The history of a Codex chat is entirely input, so its ceiling is 922,000, not 1,050,000.

### Within the server catalog

The Codex server catalog gives these models `max_context_window = 872000` with `effective_context_window_percent = 95`, and `model_context_window` cannot be raised above that maximum. Reaching it needs no custom catalog, only these settings in `~/.codex/config.toml`:

```toml
model_context_window = 872000
model_auto_compact_token_limit = 872000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

Compact then starts at 828,400 tokens (95% of 872,000), which leaves 93,600 tokens below the input ceiling.

### Beyond the server catalog

> [!CAUTION]
> This setup goes past what the server catalog allows and is not supported by OpenAI. The Codex team [recommends the default window settings](https://github.com/openai/codex/issues/19409#issuecomment-4315638228) and has [warned](https://github.com/openai/codex/issues/19464#issuecomment-4364763432) that client-side overrides can leave a chat that cannot be compacted. That is what happened in the test described below. Use it only if you accept that risk.

To use the whole documented input, create a local catalog:

```bash
python scripts/create-catalog.py
```

The script copies the model list from `~/.codex/models_cache.json` and sets two fields for seven GPT-6 and GPT-5.6 models: `max_context_window` becomes 922,000, and `effective_context_window_percent` is set to 95, the share the server catalog already uses. Other models are left as they are. The catalog is not stored in Git because it depends on the client version and on what the account can access; create it again when new models appear.

Point the settings at the catalog and raise both values:

```toml
model_catalog_json = "/home/USER/.codex/codex-1m/catalog.json"
model_context_window = 922000
model_auto_compact_token_limit = 922000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

Compact then starts at 875,900 tokens (95% of 922,000), and the same value is the denominator of the context indicator in Zed. The catalog path must be absolute; on Windows it has the form `C:/Users/USER/.codex/codex-1m/catalog.json`. The share is set by the `EFFECTIVE_PERCENT` constant in the script; after changing it, create the catalog again in each OS.

### Why the threshold stays below the limit

> [!WARNING]
> Do not remove the margin of 46,100 tokens between the threshold and the limit. Once the server rejects a request for its size, Codex 0.159.2 does not compact the history on its own, and the chat stays unusable.

A configuration with a 1,050,000 window and a 100% share was tried in a working GPT-6.1 Sol chat. The server accepted a request with 922,856 input tokens and rejected the next one, about 925,000 tokens, with `context_length_exceeded`. The client believed the limit was 1,050,000 and did not start compact. After such a rejection Codex 0.159.2 ends the turn with the error "Codex ran out of room in the model's context window". A compact request sends the same history and hits the same limit, so the chat remains unusable.

The client checks the threshold between model steps, and one step adds reasoning and command output to the history. In the saved chats 99% of steps added no more than 11,292 tokens, and two steps out of 7,647 added more than the 46,100 margin: 51,897 and 90,254. The largest came from a single response that reasoned for 54 minutes before it was interrupted; its unfinished reasoning stayed in the history. A step of that size close to the threshold stops the chat again. A higher share makes this more likely: at 97% the margin is 27,660, and six steps exceeded it.

## Validation status

- 7 integration checks of the context calculation pass on 0.159.2 and on 0.160.0, including session restore and both threshold modes.
- On unpatched 0.160.0 sources the four new cases fail: Codex sends the compact request that the patch prevents.
- 5 tests pass on both versions in the module that needed a raised compiler recursion limit.
- The full test suite of the source tree was not run.
- A binary was built and installed only from 0.159.2. In a working chat after installation the context reached 922,856 input tokens without premature compact; before the fix the same chat was compacted at 734,065.
- Compact at the configured threshold has not yet been observed in a working chat.

To repeat the checks, run in `codex-rs` of the patched sources:

```bash
export RUST_MIN_STACK=8388608
cargo test -p codex-core --test all -- all_turns_reasoning_without_header_does_not_compact_twice auto_compact_accounts_for_encrypted_reasoning auto_compact_body_after_prefix_still_caps_at_context_window
cargo test -p codex-chatgpt
```

The stack size is the one the project's own test recipe sets; without it the unoptimized test binary overflows its stack.
