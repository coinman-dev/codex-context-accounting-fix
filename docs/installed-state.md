# Installation and validation, 4 October 2026

After Zed was restarted, the processes actually running on both platforms were checked. Windows started `.codex/context-accounting-fix/0.159.2-reasoning-0ae0125731/bin/codex.exe`, Ubuntu the matching `bin/codex`. The checksums matched the installation manifests:

| Platform | SHA-256 of the main file |
| --- | --- |
| Windows | `35fd7ede96b944ceeba670c82ccd590982fa390251b55d7b25cc92d79f551a82` |
| Ubuntu | `dd32d57a00f18bbae5a2c41201078630a3403e1562d8e90ad4ebd90d6d89b3d9` |

Both OSes have version `0.159.2-reasoning-0ae0125731` installed. It is based on upstream Codex 0.159.2, commit `ff6aec96948b70d94983af2641a6b67c94faeff5`; the SHA-256 of the patch is `0ae0125731fc0059b31043127067db1fe9d7eafaceebdb523b334a8cde779022`.

The regular Zed agent `agent_servers.codex-acp` keeps `type: registry`. Its `env.NODE_OPTIONS` loads the portable `preload.cjs` from the home folder of the respective OS and selects the installed fixed binary. No separate agent is needed in the model panel. The selection during validation was GPT-6.1 Sol, xhigh; the accounting fix depends on the model's API mode and is not tied to one model name.

Both `~/.codex/config.toml` files hold these settings:

```toml
model_context_window = 922000
model_auto_compact_token_limit = 922000
model_auto_compact_token_limit_scope = "body_after_prefix"
model_post_turn_compact_threshold_percent = 0
```

`model_catalog_json` points to the absolute path of `~/.codex/codex-1m/catalog.json` in its own OS. The catalog was created by `scripts/create-catalog.py` and differs from the server's model list in one field for seven GPT-6 and GPT-5.6 models: `max_context_window` is 922,000 instead of 872,000. The share `effective_context_window_percent` is the server's 95%, so compact starts at 875,900 tokens, which leaves a margin of 46,100 below the input limit. From the evening of 4 October until 5 October the share was 97% (threshold 894,340, margin 27,660); it was lowered after a single response added 90,254 tokens of reasoning to a chat. The catalog and the installed folder `~/.codex/context-accounting-fix` are required for operation; they are not temporary build files. The previous configurations and catalogs are kept next to the new ones with the suffix `.bak-2026-10-04-window-1050000`.

922,000 is the maximum input in the OpenAI documentation for these models: the 1,050,000 window also includes 128,000 output tokens. Until the evening of 4 October both OSes had a 1,050,000 window, a 1,050,000 threshold and a catalog with a 100% share. In a working chat on Ubuntu a request with 922,856 input tokens went through, and the next one, estimated by the client at 925,227, was rejected by the server at 19:05:42 UTC with `context_length_exceeded`. At that moment the client saw a limit of 1,050,000 and did not start compact.

The cause of the early compact: with 737,658 tokens in the server's accounting, the client added 313,149 tokens of old encrypted reasoning a second time, plus 946 local tokens, which gave 1,051,753. The patch keeps the correct accounting contract for the previous response and sets it for the model of the actual request. See the README and the patch itself for details.

When Windows is built from Ubuntu, the SQL migrations must have CRLF: all 73 SQLx checksums in the existing Windows databases matched CRLF. The new CRLF build opened the working profile successfully. Databases and chat history were not changed for this.

Checks: 7 integration tests of the context accounting, 5 `codex-chatgpt` tests, formatting, release builds for both platforms, and `initialize`/`session/new` through the stock ACP adapter on the existing profiles. The ACP check sent no requests to the model. The full upstream test suite was not run. In a working chat on Ubuntu after installation the context reached 922,856 input tokens without premature compact, so the double counting of reasoning is gone. Compact at the configured threshold has not yet been observed in a working chat. After each change of the settings, on 4 and 5 October, `codex debug models` and `scripts/probe.cjs` passed in both OSes: the fixed binary loads the catalog with 922,000 and the configured share, `initialize` and `session/new` through the stock ACP adapter succeed, and no requests were sent to the model.

On 5 October the patch was validated on the Codex 0.160.0 sources (commit `a956835d020762cb2b570053af06f643a11c0ecc`): it applies unchanged, the 7 integration checks and the 5 `codex-chatgpt` tests pass, and without the two source changes the four new cases fail with an extra compact request. No binaries were built or installed from 0.160.0.

To reinstall, use the scripts and the instructions in the README. After the files are updated, an agent that is already connected is switched through the chat panel menu `⋯ → Reload Agent` once the current work has finished. The installation does not depend on temporary source or build directories.

## Prerelease validation, 6 October 2026

The `v0.160.0-reasoning.1` archives were built locally in WSL2 from upstream commit `a956835d020762cb2b570053af06f643a11c0ecc`, using the same accounting patch. Windows was cross-compiled with `cargo-xwin` after normalizing all 73 SQL migrations to CRLF. Linux was built inside a private Ubuntu 22.04 environment; `readelf` confirms its highest glibc requirement is `GLIBC_2.35`.

Seven accounting integration cases passed, plus five `codex-chatgpt` unit tests and two integration tests. These were run in the ordinary debug test profile: upstream's release-mode temp-directory guard rejects the temporary `CODEX_HOME` created by its test initializer. The unsuccessful GitHub run failed at that initializer after its Linux CLI had compiled; the release binaries published here came from the subsequent local builds.

Both actual release archives passed app-server startup, the stock ACP adapter's `initialize` and `session/new` on the existing signed-in profiles, and model-catalog loading. These checks sent no inference requests. Installation, verification and rollback of the release archives were also exercised in isolated Windows/WSL profiles, including a Windows home path containing spaces. An unauthenticated profile correctly reports that sign-in is required, rather than treating this as a broken installation.

The PowerShell 5.1 coordinator passed installation, repeat installation, two successive rollbacks, checksum rejection, and automatic restoration of Windows after a WSL startup failure. The Node installer tests passed on both platforms, covering JSONC settings, CLI selection, preservation of manual edits, rollback and corrupt packages. Startup checks wait for each Codex process to exit before reopening SQLite, avoiding a race between the direct app-server probe and ACP.

`release.json` and `SHA256SUMS` contain the binary/archive hashes and the upstream/patch identity. The signed-in working installations recorded above remain on 0.159.2 until the user runs the new installer; the release verification did not switch their active binaries or Zed settings. A full upstream test suite and a real-model compaction at the threshold were not run for this prerelease.

The installer was subsequently corrected for WSL with `[automount] enabled = false`. It now transfers cached Windows files directly through `wsl.exe` stdin, using a bounded binary stream and checking SHA-256 before activating each Linux cache file. It no longer uses `wslpath` or mounted Windows drives. PowerShell 5.1 checks cover the actual Windows profile cache path containing spaces, the large Linux archive, cache reuse, corruption repair, full installation in both OSes and rollback with Windows drive mounts disabled. The Rust binaries are unchanged.

## Disk cleanup, 8 October 2026

Both working installations now select `0.160.0-reasoning.1`. The cleanup audit found 1,247.9 MiB of downloads/staging in Windows and 755.3 MiB in WSL2; these were removed after verifying the active binaries. The old `0.159.2-reasoning-0ae0125731` folders are referenced by transaction `21f037b343fe4ba9b39daa1eb8d718a6` and remain necessary for rollback. The active release, launchers, preload, manifests and small transaction backups are retained.

The installer now cleans managed downloads automatically only after the whole installation is committed and verified. `-Cleanup` runs housekeeping separately, and `-KeepDownloads` preserves archives while discarding expanded staging copies. Cleanup protects running executables and recursively follows saved rollback pointers; it refuses modified binaries, pending installations, and symlinks/junctions in removal candidates. A Windows installation lock prevents concurrent installer/cleanup runs. Offline input archives outside the managed downloads folder remain untouched.

Local cleanup tests and full PowerShell 5.1 Windows/WSL installation, repeated installation, checks, two rollbacks, checksum rejection and cross-platform failure recovery passed. Additional obsolete test fixtures from the project build directories were removed: 29.04 GiB in Windows and 12.31 GiB in the WSL checkout. Published archives, vendor fixtures and compiler caches were preserved.
