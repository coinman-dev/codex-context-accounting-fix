[English](/README.md) | [Русский](/README.ru_RU.md)

# Codex context accounting fix

[![Codex 0.159.2](https://img.shields.io/badge/Codex-0.159.2-10A37F.svg)](#building)
[![Windows | Ubuntu/WSL2](https://img.shields.io/badge/Windows%20%7C%20Ubuntu%2FWSL2-x64-0078D4.svg)](#installation)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

**codex-context-accounting-fix** is a local fix for **Codex 0.159.2** running in Zed on Windows and Ubuntu/WSL2. Without it Codex counts stored reasoning twice and compacts a chat long before the context is full. The repository holds the patch, the scripts that install the rebuilt binary next to the official one, and the window settings that let a chat use the model's whole input.

Only the sources needed to reproduce the fix are stored here. Built binaries, model catalogs, logs and account data are not.

## Why compact started too early

With `reasoning.context = all_turns` the server already includes stored reasoning in `input_tokens`. When a response had no `x-reasoning-included` header, Codex estimated the same reasoning a second time and started compact before the context was full.

In the chat that was investigated, the Zed indicator showed 737,658 tokens. Codex added an estimate of 313,149 tokens of earlier reasoning and 946 tokens of new tool results, which gave 1,051,753 against a limit of 1,050,000. See the [report of a similar bug](https://github.com/openai/codex/issues/39767).

## What the patch does

The patch decides how reasoning is counted from the request mode, keeps the previous response's flag until the check before a new turn has run, and recomputes it for the model of the actual request. The content of the history is not changed. For models where the server does not count earlier reasoning, the previous calculation is kept.

## Repository contents

| File | Purpose |
| --- | --- |
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

Clone [OpenAI Codex](https://github.com/openai/codex) at tag `rust-v0.159.2` and apply the patch in the root of its sources:

```bash
git clone --depth 1 --branch rust-v0.159.2 https://github.com/openai/codex.git codex-0.159.2
cd codex-0.159.2
git apply /path/to/codex-context-accounting-fix/patches/codex-0.159.2-reasoning-accounting.patch
cd codex-rs
```

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

The 1,050,000-token window that OpenAI lists for the GPT-6 and GPT-5.6 models is split between input and output: the [model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) gives a maximum input of 922,000 tokens and a maximum output of 128,000. The history of a Codex chat is entirely input, so its ceiling is 922,000, not 1,050,000. The Codex server catalog allows the client even less: `max_context_window = 872000` with `effective_context_window_percent = 95`, and `model_context_window` cannot be raised above that maximum.

To use the whole documented input, create a local catalog:

```bash
python scripts/create-catalog.py
```

The script copies the model list from `~/.codex/models_cache.json` and changes two fields for seven GPT-6 and GPT-5.6 models: `max_context_window` becomes 922,000 and `effective_context_window_percent` becomes 97. Other models are left as they are. The catalog is not stored in Git because it depends on the client version and on what the account can access; create it again when new models appear.

Settings in `~/.codex/config.toml`:

```toml
model_catalog_json = "/home/USER/.codex/codex-1m/catalog.json"
model_context_window = 922000
model_auto_compact_token_limit = 922000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

With these settings compact starts at 894,340 tokens (97% of 922,000), and the same value is the denominator of the context indicator in Zed. The catalog path must be absolute; on Windows it has the form `C:/Users/USER/.codex/codex-1m/catalog.json`. The share is set by the `EFFECTIVE_PERCENT` constant in the script; after changing it, create the catalog again in each OS.

### Why the threshold stays below the limit

> [!WARNING]
> Do not remove the margin of 27,660 tokens between the threshold and the limit. Once the server rejects a request for its size, Codex 0.159.2 does not compact the history on its own, and the chat stays unusable.

A configuration with a 1,050,000 window and a 100% share was tried in a working GPT-6.1 Sol chat. The server accepted a request with 922,856 input tokens and rejected the next one, about 925,000 tokens, with `context_length_exceeded`. The client believed the limit was 1,050,000 and did not start compact. After such a rejection Codex 0.159.2 ends the turn with the error "Codex ran out of room in the model's context window". A compact request sends the same history and hits the same limit, so the chat remains unusable.

The client checks the threshold between model steps, and one step adds reasoning and command output to the history. In the saved chats 99% of steps added no more than 11,252 tokens, five steps out of 7,326 added more than the current margin, and the largest added 51,897. A step of that size close to the threshold stops the chat again, so the 97% share accepts this risk deliberately. The server's 95% share gives a threshold of 875,900 and a margin of 46,100.

## Validation status

- 7 integration checks of the context calculation pass, including session restore and both threshold modes.
- 5 tests pass in the module that needed a raised compiler recursion limit.
- The full test suite of the source tree was not run.
- In a working chat after installation the context reached 922,856 input tokens without premature compact; before the fix the same chat was compacted at 734,065.
- Compact at the 894,340 threshold has not yet been observed in a working chat.
