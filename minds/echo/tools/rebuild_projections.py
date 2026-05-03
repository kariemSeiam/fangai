#!/usr/bin/env python3
"""
ECHO 2.0 — rebuild role projections from the append-only spine (incremental).

Reads spine segments from spine/manifest.json, applies type-filtered reducers per
role defined in config/roles.json (include_type_prefixes).

The `echo` role matches every event (prefix \"*\") and adds sections[\"events_index\"]
with a compact row per spine event (full index). Other roles emit only the five
standard section keys.

Env:
  ECHO_ROOT  Root directory (config/, spine/, projections/). Default: grandparent of this file.

Python 3 stdlib only.
"""

from __future__ import annotations

import argparse
import copy
import fnmatch
import json
import os
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Iterator

# ─── constants ───────────────────────────────────────────────────────────────

PROJECTION_SCHEMA = "echo.projection.v1"
META_SCHEMA = "echo.projection_meta.v1"

ROLE_ORDER = (
    "helm",
    "hunt",
    "edge",
    "molt",
    "omen",
    "weld",
    "mend",
    "call",
    "dart",
    "echo",
)

DEFAULT_ROLES: dict[str, dict[str, Any]] = {
    "helm": {
        "include_type_prefixes": [
            "echo.decision.",
            "echo.claim.",
            "echo.disagreement.",
            "echo.deprecation.",
            "echo.verify.",
            "echo.session.",
            "echo.pattern.",
        ]
    },
    "hunt": {
        "include_type_prefixes": [
            "echo.hunt.",
            "echo.session.",
            "echo.pattern.",
            "echo.claim.",
        ]
    },
    "edge": {
        "include_type_prefixes": [
            "echo.edge.",
            "echo.pattern.",
            "echo.claim.",
            "echo.disagreement.",
        ]
    },
    "molt": {
        "include_type_prefixes": [
            "echo.molt.",
            "echo.pattern.",
            "echo.claim.",
            "echo.session.",
        ]
    },
    "omen": {
        "include_type_prefixes": [
            "echo.omen.",
            "echo.claim.",
            "echo.session.",
            "echo.disagreement.",
        ]
    },
    "weld": {
        "include_type_prefixes": [
            "echo.weld.",
            "echo.decision.",
            "echo.pattern.",
            "echo.claim.",
        ]
    },
    "mend": {
        "include_type_prefixes": [
            "echo.mend.",
            "echo.session.",
            "echo.pattern.",
            "echo.claim.",
        ]
    },
    "call": {
        "include_type_prefixes": [
            "echo.call.",
            "echo.decision.",
            "echo.disagreement.",
            "echo.session.",
        ]
    },
    "dart": {
        "include_type_prefixes": [
            "echo.dart.",
            "echo.decision.",
            "echo.claim.",
            "echo.pattern.",
        ]
    },
    "echo": {"include_type_prefixes": ["*"]},
}


# ─── paths ───────────────────────────────────────────────────────────────────

def get_echo_root(override: Path | None = None) -> Path:
    if override is not None:
        return override.resolve()
    env = os.environ.get("ECHO_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parent.parent


def canonical_json_bytes(obj: dict[str, Any]) -> bytes:
    s = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return s.encode("utf-8")


def utc_now_iso_z() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="microseconds")
        .replace("+00:00", "Z")
    )


def atomic_write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(txt, encoding="utf-8")
    tmp.replace(path)


# ─── roles config ─────────────────────────────────────────────────────────────

def load_roles_config(config_path: Path) -> dict[str, dict[str, Any]]:
    if not config_path.exists():
        return copy.deepcopy(DEFAULT_ROLES)
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{config_path}: root must be a JSON object")

    agents: dict[str, Any] | None = None
    if isinstance(raw.get("roles"), dict):
        agents = raw["roles"]  # type: ignore[assignment]
    elif isinstance(raw.get("agents"), dict):
        agents = raw["agents"]  # type: ignore[assignment]
    else:
        # Flat file: {"helm": {...}, ...}
        hinted = isinstance(raw.get("helm"), dict)
        generic = isinstance(raw.get("echo"), dict) or hinted
        if generic:
            agents = {k: v for k, v in raw.items() if isinstance(k, str) and isinstance(v, dict)}

    if not isinstance(agents, dict):
        raise ValueError(
            f"{config_path}: expected 'roles'/agents object OR flat mapping of role->config",
        )
    out: dict[str, dict[str, Any]] = {}
    for role, body in agents.items():
        if not isinstance(body, dict):
            continue
        prefs = body.get("include_type_prefixes")
        if not isinstance(prefs, list) or not all(isinstance(p, str) for p in prefs):
            raise ValueError(f"{config_path}: role {role!r} needs include_type_prefixes: string list")
        out[role] = {"include_type_prefixes": prefs}
    for r in ROLE_ORDER:
        out.setdefault(r, DEFAULT_ROLES[r])
    return out


def type_matches(event_type: str, prefixes: list[str], *, role_name: str) -> bool:
    if role_name == "echo":
        return True
    if "*" in prefixes:
        return True
    for p in prefixes:
        if p == "*":
            return True
        if event_type.startswith(p.rstrip("*")) and p.endswith("*"):
            prefix = p[:-1]
            if prefix and event_type.startswith(prefix):
                return True
            continue
        if fnmatch.fnmatch(event_type, p):
            return True
        if event_type == p:
            return True
        if p.endswith(".") and event_type.startswith(p):
            return True
        if not p.endswith(".") and not p.endswith("*") and event_type.startswith(p + "."):
            return True
    return False


# ─── spine iteration ───────────────────────────────────────────────────────────

def load_manifest(spine_dir: Path) -> dict[str, Any]:
    mp = spine_dir / "manifest.json"
    if not mp.exists():
        raise FileNotFoundError(f"missing spine manifest: {mp}")
    return json.loads(mp.read_text(encoding="utf-8"))


def iter_spine_events(
    spine_dir: Path,
    *,
    after_event_id: int,
) -> Iterator[dict[str, Any]]:
    man = load_manifest(spine_dir)
    segs = man.get("segments")
    if not isinstance(segs, list):
        raise ValueError("manifest.json: 'segments' must be a list")
    for seg in segs:
        if not isinstance(seg, dict):
            continue
        fn = seg.get("file")
        if not isinstance(fn, str):
            continue
        path = spine_dir / fn
        if not path.exists():
            raise FileNotFoundError(f"segment file referenced in manifest not found: {path}")
        with open(path, encoding="utf-8", newline="\n") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if not isinstance(ev, dict):
                    raise ValueError(f"invalid event JSON (not object) in {path}")
                eid = ev.get("event_id")
                if not isinstance(eid, int):
                    raise ValueError(f"missing integer event_id in {path}: {ev!r:.200}")
                if eid <= after_event_id:
                    continue
                yield ev


# ─── state ─────────────────────────────────────────────────────────────────────

def fresh_sections_state(role: str) -> dict[str, Any]:
    base: dict[str, Any] = {
        "claims": {},  # claim_key -> claim record dict
        "sessions": [],  # list of {event_id, ref, snippet}
        "decisions": [],  # list of {event_id, payload_summary}
        "patterns": [],  # list of {event_id, payload_summary}
        "disagreements": {"active": [], "resolved": []},
    }
    if role == "echo":
        base["events_index"] = []
    return base


def hydrate_state_from_projection(sections_in: dict[str, Any] | None, role: str) -> dict[str, Any]:
    s = fresh_sections_state(role)
    if not sections_in:
        return s
    if isinstance(sections_in.get("claims"), dict):
        s["claims"].update(copy.deepcopy(sections_in["claims"]))
    if isinstance(sections_in.get("sessions"), list):
        s["sessions"] = copy.deepcopy(sections_in["sessions"])
    if isinstance(sections_in.get("decisions"), list):
        s["decisions"] = copy.deepcopy(sections_in["decisions"])
    if isinstance(sections_in.get("patterns"), list):
        s["patterns"] = copy.deepcopy(sections_in["patterns"])
    dg = sections_in.get("disagreements")
    if isinstance(dg, dict):
        s["disagreements"]["active"] = copy.deepcopy(
            dg.get("active") if isinstance(dg.get("active"), list) else [],
        )
        s["disagreements"]["resolved"] = copy.deepcopy(
            dg.get("resolved") if isinstance(dg.get("resolved"), list) else [],
        )
    if role == "echo" and isinstance(sections_in.get("events_index"), list):
        s["events_index"] = copy.deepcopy(sections_in["events_index"])
    return s


# ─── reducers ─────────────────────────────────────────────────────────────────

def fingerprint_value(val: Any) -> str:
    if isinstance(val, dict):
        h = canonical_json_bytes(val)
    elif isinstance(val, (str, int, float)) or val is True or val is False or val is None:
        h = canonical_json_bytes({"__v": val})
    elif isinstance(val, list):
        h = canonical_json_bytes({"__lst": val})
    else:
        h = canonical_json_bytes({"__repr": repr(val)})
    return sha256(h).hexdigest()


def extract_claim_key(ev: dict[str, Any]) -> str | None:
    ts = ev.get("trust_subject")
    if isinstance(ts, str) and ts.strip():
        return ts.strip()
    cks = ev.get("claim_keys")
    if isinstance(cks, list) and cks and isinstance(cks[0], str):
        return cks[0]
    p = ev.get("payload") or {}
    if isinstance(p, dict):
        ck = p.get("claim_key")
        if isinstance(ck, str) and ck.strip():
            return ck.strip()
    return None


def snapshot_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        k: payload[k]
        for k in sorted(payload.keys())
        if not k.startswith("_")
    }


def reducer_claim_asserted(state: dict[str, Any], ev: dict[str, Any]) -> None:
    ck = extract_claim_key(ev)
    if not ck:
        return
    p = ev.get("payload") or {}
    if not isinstance(p, dict):
        return
    if "value_fingerprint" in p and isinstance(p["value_fingerprint"], str):
        fp = p["value_fingerprint"]
    elif "value" in p:
        fp = fingerprint_value(p["value"])
    else:
        fp = fingerprint_value(snapshot_payload(p))
    rec = state["claims"].get(ck)
    if rec is None:
        state["claims"][ck] = {
            "claim_key": ck,
            "trust": "provisional",
            "value_fingerprint": fp,
            "asserted_event_ids": [ev["event_id"]],
            "promotions": [],
            "deprecated": False,
        }
    else:
        rec["asserted_event_ids"].append(ev["event_id"])
        rec["claim_key"] = ck
        if rec.get("value_fingerprint") != fp:
            rec.setdefault(
                "conflicting_assertions",
                [],
            ).append({"event_id": ev["event_id"], "value_fingerprint": fp})
        else:
            rec["value_fingerprint"] = fp
            rec["trust"] = "provisional"


def reducer_claim_promoted(state: dict[str, Any], ev: dict[str, Any]) -> None:
    ck = extract_claim_key(ev)
    if not ck:
        return
    p = ev.get("payload") or {}
    if not isinstance(p, dict):
        return
    fp_in = p.get("value_fingerprint")
    fp = fp_in if isinstance(fp_in, str) else fingerprint_value(p.get("value", p))
    t_to = p.get("trust_to")
    t_from = p.get("trust_from")
    if t_to not in ("provisional", "verified", "committed"):
        t_to = "provisional"
    entry = state["claims"].setdefault(
        ck,
        {
            "claim_key": ck,
            "trust": "provisional",
            "value_fingerprint": fp,
            "asserted_event_ids": [],
            "promotions": [],
            "deprecated": False,
        },
    )
    pm = {"event_id": ev["event_id"], "trust_from": t_from, "trust_to": t_to}
    if isinstance(fp_in, str):
        pm["value_fingerprint"] = fp_in
    entry.setdefault("promotions", []).append(pm)
    entry["trust"] = t_to
    if isinstance(fp_in, str):
        entry["value_fingerprint"] = fp


def reducer_claim_deprecated(state: dict[str, Any], ev: dict[str, Any]) -> None:
    ck = extract_claim_key(ev)
    if not ck:
        p = ev.get("payload") or {}
        if isinstance(p, dict):
            tr = p.get("target_ref")
            if isinstance(tr, str):
                ck = tr
    if not ck:
        return
    rec = state["claims"].setdefault(
        ck,
        {
            "claim_key": ck,
            "trust": "provisional",
            "value_fingerprint": None,
            "asserted_event_ids": [],
            "promotions": [],
            "deprecated": False,
        },
    )
    rec["deprecated"] = True
    rec["deprecated_event_id"] = ev["event_id"]


def reducer_session_archived(state: dict[str, Any], ev: dict[str, Any]) -> None:
    p = ev.get("payload") or {}
    if not isinstance(p, dict):
        p = {}
    ref = (
        p.get("session_id")
        or p.get("sid")
        or p.get("id")
        or p.get("session_ref")
        or None
    )
    if isinstance(ref, (dict, list)):
        ref = json.dumps(ref, sort_keys=True)[:240]
    state["sessions"].append(
        {
            "event_id": ev["event_id"],
            "ref": ref,
            "producer": ev.get("producer"),
        },
    )


def reducer_decision_recorded(state: dict[str, Any], ev: dict[str, Any]) -> None:
    p = ev.get("payload") or {}
    sid = snapshot_payload(p) if isinstance(p, dict) else {}
    state["decisions"].append(
        {
            "event_id": ev["event_id"],
            "producer": ev.get("producer"),
            "summary": sid,
        },
    )


def reducer_pattern_proposed(state: dict[str, Any], ev: dict[str, Any]) -> None:
    p = ev.get("payload") or {}
    sid = snapshot_payload(p) if isinstance(p, dict) else {}
    pid = p.get("pattern_candidate_id") if isinstance(p, dict) else None
    entry: dict[str, Any] = {
        "event_id": ev["event_id"],
        "producer": ev.get("producer"),
        "pattern_candidate_id": pid,
        "summary": sid,
    }
    state["patterns"].append(entry)


def reducer_disagreement_opened(state: dict[str, Any], ev: dict[str, Any]) -> None:
    p = ev.get("payload") or {}
    if not isinstance(p, dict):
        p = {}
    dg_id = p.get("disagreement_id") or ev.get("correlation_id")
    if dg_id is None:
        dg_id = f"dangling-{ev['event_id']}"
    claim_key = p.get("claim_key") or extract_claim_key(ev)
    item = {
        "disagreement_id": dg_id,
        "opened_event_id": ev["event_id"],
        "claim_key": claim_key,
        "payload": snapshot_payload(p),
    }
    state["disagreements"]["active"].append(item)


def reducer_disagreement_resolved(state: dict[str, Any], ev: dict[str, Any]) -> None:
    p = ev.get("payload") or {}
    if not isinstance(p, dict):
        p = {}

    raw_id = p.get("disagreement_id")
    oc = p.get("outcome")

    dg_src = raw_id
    if dg_src is None and isinstance(oc, dict):
        oc_id = oc.get("disagreement_id")
        if isinstance(oc_id, str) or isinstance(oc_id, int):
            dg_src = oc_id

    if dg_src is None:
        dg_id: str | None = None
    else:
        dg_id = str(dg_src)

    active = state["disagreements"]["active"]

    if dg_id is None:
        state["disagreements"]["resolved"].append(
            {
                "disagreement_id": None,
                "resolved_event_id": ev["event_id"],
                "note": "resolve_missing_disagreement_id",
                "payload": snapshot_payload(p),
            },
        )
        return

    idx = None
    for i, it in enumerate(active):
        if str(it.get("disagreement_id")) == dg_id:
            idx = i
            break
    if idx is None:
        orphaned = {
            "disagreement_id": dg_id,
            "resolved_event_id": ev["event_id"],
            "note": "resolve_without_matching_open_payload",
            "payload": snapshot_payload(p),
        }
        state["disagreements"]["resolved"].append(orphaned)
        return
    item = active.pop(idx)
    item["resolved_event_id"] = ev["event_id"]
    item["resolution"] = snapshot_payload(p)
    state["disagreements"]["resolved"].append(item)


ReducerFn = Callable[[dict[str, Any], dict[str, Any]], None]

REDUCERS: dict[str, ReducerFn] = {
    "echo.claim.asserted": reducer_claim_asserted,
    "echo.claim.promoted": reducer_claim_promoted,
    "echo.claim.deprecated": reducer_claim_deprecated,
    "echo.session.archived": reducer_session_archived,
    "echo.decision.recorded": reducer_decision_recorded,
    "echo.pattern.proposed": reducer_pattern_proposed,
    "echo.disagreement.opened": reducer_disagreement_opened,
    "echo.disagreement.resolved": reducer_disagreement_resolved,
}


def append_events_index_row(state: dict[str, Any], ev: dict[str, Any]) -> None:
    if "events_index" not in state:
        return
    row = {
        "event_id": ev.get("event_id"),
        "ts": ev.get("ts"),
        "type": ev.get("type"),
        "producer": ev.get("producer"),
        "trust_at_emit": ev.get("trust_at_emit"),
        "trust_subject": ev.get("trust_subject"),
        "claim_keys": ev.get("claim_keys"),
        "correlation_id": ev.get("correlation_id"),
    }
    state["events_index"].append(row)


def process_event(ev: dict[str, Any], *, role_name: str, prefixes: list[str], state: dict[str, Any]) -> None:
    if role_name == "echo":
        append_events_index_row(state, ev)
    matched = type_matches(ev.get("type", ""), prefixes, role_name=role_name)
    if not matched:
        return
    fn = REDUCERS.get(ev.get("type"))
    if fn:
        fn(state, ev)


def build_projection_doc(
    role_name: str,
    *,
    sections: dict[str, Any],
    watermark_event_id: int,
) -> dict[str, Any]:
    sections_out: dict[str, Any] = {
        "claims": sections["claims"],
        "sessions": sections["sessions"],
        "decisions": sections["decisions"],
        "patterns": sections["patterns"],
        "disagreements": sections["disagreements"],
    }
    if role_name == "echo" and "events_index" in sections:
        sections_out["events_index"] = sections["events_index"]
    return {
        "role": role_name,
        "schema_version": PROJECTION_SCHEMA,
        "watermark_event_id": watermark_event_id,
        "built_at_ts": utc_now_iso_z(),
        "sections": sections_out,
    }


# ─── rebuild one role ──────────────────────────────────────────────────────────

def rebuild_role(
    role_name: str,
    *,
    echo_root: Path,
    roles_cfg: dict[str, dict[str, Any]],
    full: bool,
) -> dict[str, Any]:
    projections_dir = echo_root / "projections"
    meta_dir = projections_dir / "meta"
    spine_dir = echo_root / "spine"
    proj_path = projections_dir / f"{role_name}.projection.json"
    meta_path = meta_dir / f"{role_name}.meta.json"

    cfg = roles_cfg.get(role_name) or DEFAULT_ROLES[role_name]
    prefixes = cfg["include_type_prefixes"]

    watermark = 0
    sections = fresh_sections_state(role_name)

    if not full and meta_path.exists():
        meta_raw = json.loads(meta_path.read_text(encoding="utf-8"))
        wm_meta = meta_raw.get("watermark_event_id")
        if isinstance(wm_meta, int):
            watermark = wm_meta

    if not full and proj_path.exists():
        prev = json.loads(proj_path.read_text(encoding="utf-8"))
        sec = prev.get("sections")
        sections = hydrate_state_from_projection(sec if isinstance(sec, dict) else {}, role_name)
        wm_proj = prev.get("watermark_event_id")
        if not meta_path.exists() and isinstance(wm_proj, int):
            watermark = wm_proj

    if full:
        watermark = 0
        sections = fresh_sections_state(role_name)

    max_processed = watermark
    for ev in iter_spine_events(spine_dir, after_event_id=watermark):
        eid = ev["event_id"]
        process_event(ev, role_name=role_name, prefixes=prefixes, state=sections)
        max_processed = max(max_processed, eid)

    new_wm = max_processed

    doc = build_projection_doc(role_name, sections=sections, watermark_event_id=new_wm)
    meta_doc = {
        "schema_version": META_SCHEMA,
        "role": role_name,
        "watermark_event_id": new_wm,
        "built_at_ts": doc["built_at_ts"],
        "projection_path": proj_path.name,
    }

    atomic_write_json(proj_path, doc)
    atomic_write_json(meta_path, meta_doc)

    return doc


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = argparse.ArgumentParser(description="Rebuild ECHO role projections from spine.")
    parser.add_argument("--echo-root", type=Path, default=None)
    parser.add_argument(
        "--role",
        choices=list(ROLE_ORDER),
        default=None,
        help="Rebuild a single role only (default: all roles)",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Ignore cached watermark/state; replay full spine into fresh state.",
    )

    args = parser.parse_args(argv)
    echo_root = get_echo_root(args.echo_root)

    config_path = echo_root / "config" / "roles.json"

    roles_cfg = load_roles_config(config_path)

    targets = list(ROLE_ORDER) if args.role is None else [args.role]
    for r in targets:
        rebuild_role(r, echo_root=echo_root, roles_cfg=roles_cfg, full=args.full)

    print(
        f"[echo] rebuilt projections ({', '.join(targets)}) from spine/manifest segments",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
