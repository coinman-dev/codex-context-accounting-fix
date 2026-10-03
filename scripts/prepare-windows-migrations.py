"""Match SQLite migration checksums from the official Windows Codex build."""
import argparse
import os
from pathlib import Path


DIRS = (
    "migrations",
    "logs_migrations",
    "goals_migrations",
    "memory_migrations",
    "queue_migrations",
    "thread_history_migrations",
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex-rs", required=True, type=Path)
    parser.add_argument("--mode", choices=("crlf", "lf"), default="crlf")
    args = parser.parse_args()
    state = args.codex_rs.resolve(strict=True) / "state"
    if not (state / "Cargo.toml").is_file():
        raise ValueError("--codex-rs must point to the checked-out Codex Rust workspace")
    changed = 0
    total = 0
    for folder_name in DIRS:
        folder = state / folder_name
        files = sorted(folder.glob("*.sql"))
        if not files:
            raise ValueError(f"No migrations found in {folder}")
        for path in files:
            total += 1
            original = path.read_bytes()
            lf = original.replace(b"\r\n", b"\n")
            normalized = lf.replace(b"\n", b"\r\n") if args.mode == "crlf" else lf
            if normalized != original:
                path.write_bytes(normalized)
                changed += 1
    # Force Cargo to rebuild the crate that embeds SQL with sqlx::migrate!,
    # even if a previously compiled artifact used the opposite line endings.
    os.utime(state / "src/migrations.rs")
    print(f"{args.mode.upper()}: checked {total} SQL migrations, rewrote {changed}")


if __name__ == "__main__":
    main()
