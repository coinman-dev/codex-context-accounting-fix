"""Create a local 1.05M Codex catalog from the current account's model cache."""
import argparse
import copy
import json
from pathlib import Path


SUPPORTED = {
    "gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
    "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
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
            model.update(context_window=1_050_000, max_context_window=1_050_000, effective_context_window_percent=100)
            modified.append(model["slug"])
    if not modified:
        raise ValueError("No supported 1.05M models were found in the local cache")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(catalog, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print("Wrote", args.output, "for", ", ".join(modified))


if __name__ == "__main__":
    main()
