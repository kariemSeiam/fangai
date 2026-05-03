#!/usr/bin/env python3
"""
ECHO 2.0 spine writer — single entry point for append-only events.

Env:
  ECHO_ROOT  Root directory (contains state/, spine/). Default: grandparent of this file.

Python 3 stdlib only.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── constants ───────────────────────────────────────────────────────────────

SCHEMA_VERSION = "echo.spine.v1"
MANIFEST_VERSION = "echo.manifest.v1"

SEGMENT_EVENT_CAPACITY = 10_000  # rotate file every N events (by event_id range)

_VALID_TRUST = frozenset({"provisional", "verified", "committed"})


# ─── path resolution ─────────────────────────────────────────────────────────

def get_echo_root(override: Path | None = None) -> Path:
    if override is not None:
        return override.resolve()
    env = os.environ.get("ECHO_ROOT")
    if env:
        return Path(env).resolve()
    # tools/ -> echo root
    return Path(__file__).resolve().parent.parent


# ─── json / hash ─────────────────────────────────────────────────────────────

def canonical_json_bytes(obj: dict[str, Any]) -> bytes:
    s = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return s.encode("utf-8")


def compute_payload_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def event_to_line(event: dict[str, Any]) -> str:
    return (
        json.dumps(event, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
    )


# ─── validation ────────────────────────────────────────────────────────────────

def _as_int_list(name: str, xs: Any) -> list[int]:
    if not isinstance(xs, list):
        raise ValueError(f"{name} must be a list")
    out: list[int] = []
    for i, v in enumerate(xs):
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError(f"{name}[{i}] must be int (non-bool)")
        out.append(v)
    return out


def _as_str_list(name: str, xs: Any) -> list[str]:
    if not isinstance(xs, list):
        raise ValueError(f"{name} must be a list")
    out: list[str] = []
    for i, v in enumerate(xs):
        if not isinstance(v, str):
            raise ValueError(f"{name}[{i}] must be str")
        out.append(v)
    return out


def validate_partial(partial: dict[str, Any]) -> None:
    required = ("type", "producer", "trust_at_emit", "payload")
    for k in required:
        if k not in partial:
            raise ValueError(f"missing required field: {k}")
    ta = partial["trust_at_emit"]
    if ta not in _VALID_TRUST:
        raise ValueError("trust_at_emit must be provisional|verified|committed")
    if not isinstance(partial["type"], str) or not partial["type"].strip():
        raise ValueError("type must be non-empty str")
    if not isinstance(partial["producer"], str) or not partial["producer"].strip():
        raise ValueError("producer must be non-empty str")
    pay = partial["payload"]
    if pay is None or not isinstance(pay, dict):
        raise ValueError("payload must be a dict")


def normalize_partial(partial: dict[str, Any]) -> dict[str, Any]:
    validate_partial(partial)
    causal = partial.get("causal_parents")
    if causal is None:
        causal_list: list[int] = []
    else:
        causal_list = _as_int_list("causal_parents", causal)

    ev = partial.get("evidence_refs")
    if ev is None:
        ev_list: list[str] = []
    else:
        ev_list = _as_str_list("evidence_refs", ev)

    ck = partial.get("claim_keys")
    if ck is None:
        ck_list: list[str] = []
    else:
        ck_list = _as_str_list("claim_keys", ck)

    trust_subject = partial.get("trust_subject")
    if trust_subject is not None and not isinstance(trust_subject, str):
        raise ValueError("trust_subject must be str or null")

    corr = partial.get("correlation_id")
    if corr is not None and not isinstance(corr, str):
        raise ValueError("correlation_id must be str or null")

    return {
        "type": str(partial["type"]).strip(),
        "producer": str(partial["producer"]).strip(),
        "trust_at_emit": partial["trust_at_emit"],
        "payload": partial["payload"],
        "trust_subject": trust_subject,
        "causal_parents": causal_list,
        "evidence_refs": ev_list,
        "claim_keys": ck_list,
        "correlation_id": corr,
    }


def build_enriched_event(normalized: dict[str, Any], event_id: int) -> dict[str, Any]:
    # ISO8601 UTC with Z suffix, microsecond precision
    dt = datetime.now(timezone.utc)
    ts = dt.isoformat(timespec="microseconds").replace("+00:00", "Z")

    payload = normalized["payload"]
    phash = compute_payload_hash(payload)

    event: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "event_id": event_id,
        "ts": ts,
        "type": normalized["type"],
        "producer": normalized["producer"],
        "trust_at_emit": normalized["trust_at_emit"],
        "trust_subject": normalized["trust_subject"],
        "causal_parents": list(normalized["causal_parents"]),
        "evidence_refs": list(normalized["evidence_refs"]),
        "correlation_id": normalized["correlation_id"],
        "claim_keys": list(normalized["claim_keys"]),
        "payload": payload,
        "payload_hash": phash,
    }
    return event


# ─── manifest ────────────────────────────────────────────────────────────────

def manifest_path(spine_dir: Path) -> Path:
    return spine_dir / "manifest.json"


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "schema_version": MANIFEST_VERSION,
            "segment_event_capacity": SEGMENT_EVENT_CAPACITY,
            "segments": [],
            "last_event_id": 0,
        }
    raw = json.loads(path.read_text(encoding="utf-8"))
    if "segments" not in raw:
        raw["segments"] = []
    if "last_event_id" not in raw:
        raw["last_event_id"] = 0
    return raw


def segment_filename_for_event_id(event_id: int) -> str:
    n = (event_id - 1) // SEGMENT_EVENT_CAPACITY + 1
    return f"events-{n:06d}.jsonl"


def upsert_manifest(
    manifest: dict[str, Any],
    *,
    segment_file: str,
    event_id: int,
) -> None:
    segs = manifest.setdefault("segments", [])
    manifest["segment_event_capacity"] = SEGMENT_EVENT_CAPACITY
    manifest["schema_version"] = MANIFEST_VERSION
    manifest["last_event_id"] = event_id

    if segs and segs[-1].get("file") == segment_file:
        seg = segs[-1]
        seg["last_event_id"] = event_id
        seg["line_count"] = int(seg.get("line_count", 0)) + 1
    else:
        segs.append(
            {
                "file": segment_file,
                "first_event_id": event_id,
                "last_event_id": event_id,
                "line_count": 1,
            }
        )


# ─── atomic io ─────────────────────────────────────────────────────────────────

def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, obj: Any) -> None:
    txt = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    atomic_write_text(path, txt)


# ─── core append ─────────────────────────────────────────────────────────────

def append_event(partial: dict[str, Any], *, echo_root: Path | None = None) -> dict[str, Any]:
    """
    Validate partial dict, allocate monotonic event_id under flock, append one JSON line
    to the active segment (rotate every SEGMENT_EVENT_CAPACITY ids), refresh manifest.

    Returns the full committed event dict.
    """
    root = get_echo_root(echo_root)
    state_dir = root / "state"
    spine_dir = root / "spine"
    lock_file = state_dir / "echo.lock"
    next_path = state_dir / "next_event_id.txt"

    state_dir.mkdir(parents=True, exist_ok=True)
    spine_dir.mkdir(parents=True, exist_ok=True)
    lock_file.touch(exist_ok=True)

    normalized = normalize_partial(partial)

    event: dict[str, Any] | None = None

    with open(lock_file, "r+b", buffering=0) as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)
        try:
            if next_path.exists():
                next_id = int(next_path.read_text(encoding="utf-8").strip())
            else:
                next_id = 1

            ev = build_enriched_event(normalized, next_id)
            seg_file = segment_filename_for_event_id(next_id)
            seg_path = spine_dir / seg_file

            line = event_to_line(ev)
            with open(seg_path, "a", encoding="utf-8", newline="\n") as sf:
                sf.write(line)
                sf.flush()
                os.fsync(sf.fileno())

            man = load_manifest(manifest_path(spine_dir))
            upsert_manifest(man, segment_file=seg_file, event_id=next_id)
            atomic_write_json(manifest_path(spine_dir), man)

            atomic_write_text(next_path, str(next_id + 1))
            event = ev
        finally:
            try:
                fcntl.flock(lf.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass

    assert event is not None
    return event


# ─── CLI ─────────────────────────────────────────────────────────────────────

def _parse_argv_payload(args: argparse.Namespace) -> dict[str, Any]:
    if not args.type or not args.producer or not args.trust_at_emit:
        raise SystemExit(
            "When not using stdin, require --type, --producer, and --trust-at-emit.",
        )
    try:
        payload = json.loads(args.payload or "{}")
    except json.JSONDecodeError as e:
        raise SystemExit(f"invalid JSON for --payload: {e}") from e
    if not isinstance(payload, dict):
        raise SystemExit("--payload must decode to a JSON object")

    partial: dict[str, Any] = {
        "type": args.type,
        "producer": args.producer,
        "trust_at_emit": args.trust_at_emit,
        "payload": payload,
    }
    if args.trust_subject is not None:
        partial["trust_subject"] = args.trust_subject
    if args.correlation_id is not None:
        partial["correlation_id"] = args.correlation_id

    if args.causal_parents is not None:
        parts = [p.strip() for p in args.causal_parents.split(",") if p.strip()]
        partial["causal_parents"] = [int(x) for x in parts]

    if args.evidence_refs is not None:
        refs = json.loads(args.evidence_refs)
        if not isinstance(refs, list):
            raise SystemExit("--evidence-refs must decode to a JSON array")
        partial["evidence_refs"] = refs

    if args.claim_keys is not None:
        keys = json.loads(args.claim_keys)
        if not isinstance(keys, list):
            raise SystemExit("--claim-keys must decode to a JSON array")
        partial["claim_keys"] = keys

    return partial


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = argparse.ArgumentParser(description="Append one event to ECHO spine (JSONL).")
    parser.add_argument(
        "--echo-root",
        type=Path,
        default=None,
        help="ECHO root dir (state/, spine/). Overrides ECHO_ROOT.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON to stdout (default: compact).",
    )
    parser.add_argument("--type", help="event type (CLI mode)")
    parser.add_argument("--producer", help="producer id (CLI mode)")
    parser.add_argument("--trust-at-emit", dest="trust_at_emit", help="provisional|verified|committed")
    parser.add_argument(
        "--payload",
        default="{}",
        help='JSON object string for payload (CLI mode default "{}" )',
    )
    parser.add_argument("--trust-subject", dest="trust_subject", default=None)
    parser.add_argument("--correlation-id", dest="correlation_id", default=None)
    parser.add_argument(
        "--causal-parents",
        dest="causal_parents",
        default=None,
        help="Comma-separated predecessor event IDs, e.g. 41,42",
    )
    parser.add_argument(
        "--evidence-refs",
        dest="evidence_refs",
        default=None,
        help="JSON array of evidence ref strings",
    )
    parser.add_argument(
        "--claim-keys",
        dest="claim_keys",
        default=None,
        help="JSON array of claim_key strings",
    )

    args = parser.parse_args(argv)

    try:
        if args.type:
            partial = _parse_argv_payload(args)
        elif not sys.stdin.isatty():
            raw = sys.stdin.read()
            if not raw.strip():
                raise SystemExit("empty stdin JSON (use --type ... or pipe a JSON object)")
            partial = json.loads(raw)
            if not isinstance(partial, dict):
                raise SystemExit("stdin JSON must be an object")
        else:
            parser.print_help()
            raise SystemExit("Provide --type/--producer/--trust-at-emit or pipe JSON via stdin.")

        event = append_event(partial, echo_root=args.echo_root)

        if args.pretty:
            print(json.dumps(event, indent=2, ensure_ascii=False, sort_keys=True))
        else:
            print(json.dumps(event, separators=(",", ":"), ensure_ascii=False, sort_keys=True))
        return 0
    except (ValueError, OSError, json.JSONDecodeError) as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
