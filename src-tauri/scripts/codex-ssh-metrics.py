"""Read-only Codex projection, executed through SSH stdin; standard library only.

Only explicitly whitelisted usage/identity fields leave the host. No source lines,
messages, tool arguments, environment values or authentication files are returned.
"""
import datetime
import hashlib
import json
import os
import socket
import stat
import sys
import uuid

MAX_LINE = 32 * 1024 * 1024
MAX_EVENTS = 4000
MAX_SCAN = 128 * 1024 * 1024
COUNTERS = ("input_tokens", "output_tokens", "cached_input_tokens",
            "cache_write_input_tokens", "reasoning_output_tokens", "total_tokens")


def text(value):
    return "".join(c for c in value if not ord(c) < 32 and not 127 <= ord(c) < 160)[:160] if isinstance(value, str) else ""


def project(value):
    if not isinstance(value, dict) or not isinstance(value.get("payload"), dict):
        return None
    p = value["payload"]
    kind = value.get("type")
    fields = {}
    metric_id = None
    if kind == "session_meta":
        fields = {k: text(p[k]) for k in ("id", "session_id", "parent_thread_id") if isinstance(p.get(k), str)}
        ordinal = p.get("subagent_history_start_ordinal")
        if type(ordinal) is int and ordinal >= 0:
            fields["subagent_history_start_ordinal"] = ordinal
    elif kind == "turn_context":
        fields = {"model": text(p.get("model"))}
    elif kind == "event_msg" and p.get("type") == "task_started":
        fields = {"type": "task_started"}
    elif kind == "response_item" and p.get("type") == "message" and p.get("role") == "assistant":
        fields = {"type": "message", "role": "assistant"}
    elif kind == "event_msg" and p.get("type") == "item_completed" and isinstance(p.get("item"), dict) and p["item"].get("type") == "AgentMessage":
        fields = {"type": "item_completed", "item": {"type": "AgentMessage"}}
        for key in ("started_at_ms", "completed_at_ms"):
            if type(p.get(key)) is int and p[key] > 0:
                fields[key] = p[key]
    elif kind == "token_usage_record" and isinstance(p.get("usage"), dict):
        usage = p["usage"]
        if any(type(usage.get(k)) is not int or usage[k] < 0 for k in ("output_tokens", "reasoning_output_tokens")):
            return None
        fields = {"response_id": text(p.get("response_id")), "usage": {k: usage[k] for k in ("output_tokens", "reasoning_output_tokens")}}
    elif kind == "event_msg" and p.get("type") == "token_count":
        info = p.get("info")
        usage = info.get("total_token_usage") if isinstance(info, dict) else None
        if not isinstance(usage, dict):
            return None
        # Reject unsupported numeric fields rather than manufacturing a count.
        if any(k in usage and (type(usage[k]) is not int or usage[k] < 0) for k in COUNTERS):
            raise ValueError("usage")
        if not any(k in usage for k in ("input_tokens", "output_tokens", "total_tokens")):
            raise ValueError("usage")
        dt = datetime.datetime.fromisoformat(value["timestamp"].replace("Z", "+00:00"))
        if dt.tzinfo is None:
            raise ValueError("timestamp")
        elapsed = dt - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
        millis = elapsed.days * 86400000 + elapsed.seconds * 1000 + elapsed.microseconds // 1000
        canonical = json.dumps(usage, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        metric_id = hashlib.sha256(("codex:tokens:" + str(millis) + ":" + canonical).encode("utf-8")).hexdigest()
        fields = {"type": "token_count", "info": {"total_token_usage": {k: usage[k] for k in COUNTERS if k in usage}}}
    elif kind == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
        call = p.get("call_id", p.get("id"))
        if not isinstance(call, str):
            return None
        metric_id = hashlib.sha256(("codex:tool:" + call).encode("utf-8")).hexdigest()
        fields = {k: text(p.get(k)) for k in ("call_id", "id", "name") if isinstance(p.get(k), str)}
        fields["type"] = p["type"]
    else:
        return None
    timestamp = value.get("timestamp")
    if not isinstance(timestamp, str) or len(timestamp) > 80:
        raise ValueError("timestamp")
    # Require RFC3339 time; Rust remains authoritative for metric validation.
    datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    result = {"timestamp": timestamp, "type": kind, "payload": fields}
    if metric_id is not None:
        result["metricId"] = metric_id
    if type(value.get("ordinal")) is int and value["ordinal"] >= 0:
        result["ordinal"] = value["ordinal"]
    return result


def collect(request):
    home = request.get("home") or os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
    if not isinstance(home, str) or not os.path.isabs(home):
        raise ValueError("home")
    offsets = request.get("offsets", {})
    if not isinstance(offsets, dict) or len(offsets) > 10000:
        raise ValueError("offsets")
    machine = socket.gethostname()
    # No identity file is created on the host. SSH aliases share one owner.
    try:
        with open("/etc/machine-id", encoding="ascii") as stream:
            machine = stream.read(256).strip() or machine
    except (OSError, UnicodeError):
        pass
    identity = machine + ":" + str(getattr(os, "getuid", lambda: 0)()) + ":" + os.path.realpath(home)
    result = {"format": "quota-codex-ssh-v1", "deviceId": str(uuid.uuid5(uuid.NAMESPACE_URL, "quota:" + identity)),
              "deviceName": text(socket.gethostname()), "files": [], "errors": [], "partial": False}
    if request.get("mode") == "identity":
        return result
    paths = []
    def failure(_error=None):
        if "read" not in result["errors"]:
            result["errors"].append("read")
    found = False
    for category in ("sessions", "archived_sessions"):
        root = os.path.join(home, category)
        if not os.path.exists(root):
            continue
        found = True
        for directory, folders, names in os.walk(root, followlinks=False, onerror=failure):
            depth = os.path.relpath(directory, root).count(os.sep) + (directory != root)
            folders[:] = [f for f in folders if not os.path.islink(os.path.join(directory, f))] if depth < 12 else []
            for name in names:
                path = os.path.join(directory, name)
                if not name.endswith(".jsonl") or os.path.islink(path):
                    continue
                try:
                    metadata = os.stat(path)
                    if stat.S_ISREG(metadata.st_mode):
                        paths.append((metadata.st_mtime_ns, path))
                except OSError:
                    failure()
    if not found:
        result["errors"].append("missing")
    elif not paths:
        result["errors"].append("empty")
    events = scanned = 0
    for _, path in sorted(paths, reverse=True):
        file_events = events
        relative = os.path.relpath(path, home).replace(os.sep, "/")
        start = offsets.get(relative, 0)
        if type(start) is not int or start < 0:
            raise ValueError("offset")
        try:
            with open(path, "rb") as stream:
                size = os.fstat(stream.fileno()).st_size
                reset = size < start
                if reset:
                    start = 0
                if size == start:
                    continue
                stream.seek(start)
                batch = {"path": relative, "start": start, "offset": start, "reset": reset, "events": []}
                while events < MAX_EVENTS and scanned < MAX_SCAN:
                    line = stream.readline(MAX_LINE + 1)
                    if not line or not line.endswith(b"\n"):
                        if len(line) > MAX_LINE:
                            raise ValueError("line")
                        break  # Incomplete tail remains for the next read.
                    scanned += len(line)
                    if len(line) > MAX_LINE:
                        raise ValueError("line")
                    try:
                        value = json.loads(line)
                    except (ValueError, UnicodeError):
                        raise ValueError("json")
                    projected = project(value)
                    if projected is not None:
                        batch["events"].append(projected)
                        events += 1
                    batch["offset"] = stream.tell()
                if batch["offset"] > start:
                    result["files"].append(batch)
                if events >= MAX_EVENTS or scanned >= MAX_SCAN or len(result["files"]) >= MAX_EVENTS:
                    result["partial"] = True
                    break
        except (OSError, ValueError, UnicodeError, RecursionError):
            # Drop the failed file's projection and preserve its original cursor.
            events = file_events
            failure()
    return result


def main():
    try:
        request = json.loads(sys.stdin.buffer.read(4 * 1024 * 1024 + 1))
        if request.get("format") != "quota-codex-ssh-v1":
            raise ValueError("format")
        result = collect(request)
        encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        if len(encoded) > 16 * 1024 * 1024:
            raise ValueError("size")
        sys.stdout.buffer.write(encoded)
    except Exception:
        # Never echo source text, paths, environment, exception values or stderr.
        sys.stdout.write('{"format":"quota-codex-ssh-error"}')
        sys.exit(1)


if __name__ == "__main__":
    main()
