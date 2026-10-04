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

`model_catalog_json` points to the absolute path of `~/.codex/codex-1m/catalog.json` in its own OS. The catalog was created by `scripts/create-catalog.py` and differs from the server's model list in two fields for seven GPT-6 and GPT-5.6 models: `max_context_window` is 922,000 instead of 872,000, and `effective_context_window_percent` is 97 instead of 95. Compact starts at 894,340 tokens, which leaves a margin of 27,660 below the input limit. The owner of the installation chose 97% over the server's 95% for the sake of a larger window. The catalog and the installed folder `~/.codex/context-accounting-fix` are required for operation; they are not temporary build files. The previous configurations and catalogs are kept next to the new ones with the suffix `.bak-2026-10-04-window-1050000`.

922,000 is the maximum input in the OpenAI documentation for these models: the 1,050,000 window also includes 128,000 output tokens. Until the evening of 4 October both OSes had a 1,050,000 window, a 1,050,000 threshold and a catalog with a 100% share. In a working chat on Ubuntu a request with 922,856 input tokens went through, and the next one, estimated by the client at 925,227, was rejected by the server at 19:05:42 UTC with `context_length_exceeded`. At that moment the client saw a limit of 1,050,000 and did not start compact.

The cause of the early compact: with 737,658 tokens in the server's accounting, the client added 313,149 tokens of old encrypted reasoning a second time, plus 946 local tokens, which gave 1,051,753. The patch keeps the correct accounting contract for the previous response and sets it for the model of the actual request. See the README and the patch itself for details.

When Windows is built from Ubuntu, the SQL migrations must have CRLF: all 73 SQLx checksums in the existing Windows databases matched CRLF. The new CRLF build opened the working profile successfully. Databases and chat history were not changed for this.

Checks: 7 integration tests of the context accounting, 5 `codex-chatgpt` tests, formatting, release builds for both platforms, and `initialize`/`session/new` through the stock ACP adapter on the existing profiles. The ACP check sent no requests to the model. The full upstream test suite was not run. In a working chat on Ubuntu after installation the context reached 922,856 input tokens without premature compact, so the double counting of reasoning is gone. Compact at the new 894,340 threshold has not yet been observed in a working chat. After the settings were changed on 4 October, `codex debug models` and `scripts/probe.cjs` passed in both OSes: the fixed binary loads the catalog with 922,000 and 97%, `initialize` and `session/new` through the stock ACP adapter succeed, and no requests were sent to the model.

On 5 October the patch was validated on the Codex 0.160.0 sources (commit `a956835d020762cb2b570053af06f643a11c0ecc`): it applies unchanged, the 7 integration checks and the 5 `codex-chatgpt` tests pass, and without the two source changes the four new cases fail with an extra compact request. No binaries were built or installed from 0.160.0.

To reinstall, use the scripts and the instructions in the README. After the files are updated, an agent that is already connected is switched through the chat panel menu `⋯ → Reload Agent` once the current work has finished. The installation does not depend on temporary source or build directories.
