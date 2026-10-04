"""Create a local Codex catalog that allows the full documented model input."""
import argparse
import copy
import json
from pathlib import Path


# OpenAI documents a 1,050,000 window for these models: at most 922,000 input
# tokens plus 128,000 output tokens. The chat history is input, so 922,000 is
# its ceiling. The server catalog allows clients only 872,000.
MAX_INPUT_TOKENS = 922_000
# Compact starts at this share of the input ceiling. The rest must cover one
# model step, because the compact request itself sends the whole history.
EFFECTIVE_PERCENT = 97
SUPPORTED = {
    "gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
    "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path.home() / ".codex/models_cache.json")
    parser.add_argument("--output", type=Path, default=Path.home() / ".codex/codex-1m/catalog.json")
    args = parser.parse_args()
    source = json.loads(args.source.read_text(encoding="utf-8-sig"))
    catalog = {"models": copy.deepcopy(source["models"])}
    modified = []
    for model in catalog["models"]:
        if model.get("slug") in SUPPORTED:
            model.update(max_context_window=MAX_INPUT_TOKENS, effective_context_window_percent=EFFECTIVE_PERCENT)
            modified.append(model["slug"])
    if not modified:
        raise ValueError("No supported models were found in the local cache")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(catalog, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print("Wrote", args.output, "for", ", ".join(modified))


if __name__ == "__main__":
    main()
