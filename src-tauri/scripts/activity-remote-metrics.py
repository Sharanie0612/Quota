"""Read-only CLI source projection. Only identity, model and usage whitelist
leaves the environment; never return source lines, text, arguments or auth files.
Python 3.7+, standard library. No installation or remote files are created.
"""
import base64
import csv
import datetime
import hashlib
import io
import json
import os
import socket
import stat
import sys
import uuid

LIMIT = 16 * 1024 * 1024
MAX_SCAN = 128 * 1024 * 1024
MAX_EVENTS = 4000
MAX_LINE = 32 * 1024 * 1024
ROOTS = {"codex": ".codex", "claude": ".claude/projects", "gemini": ".gemini/tmp",
         "kimi": ".kimi/sessions", "qoder": ".qoder/projects", "codebuddy": ".codebuddy/projects"}

def text(value):
    return "".join(c for c in value if ord(c) >= 32 and not 127 <= ord(c) < 160)[:160] if isinstance(value, str) else ""

def counters(value, keys):
    if not isinstance(value, dict):
        return None
    result = {}
    for key in keys:
        if key in value:
            if type(value[key]) is not int or not 0 <= value[key] <= 1000000000000:
                raise ValueError("usage")
            result[key] = value[key]
    return result

def gemini_message(value):
    if not isinstance(value, dict) or value.get("type") != "gemini":
        return None
    result = {key: text(value.get(key)) for key in ("id", "type", "timestamp", "model")}
    usage = counters(value.get("tokens"), ("input", "output", "cached", "thoughts", "tool", "total"))
    if usage is not None:
        result["tokens"] = usage
    calls = value.get("toolCalls")
    if isinstance(calls, list):
        result["toolCalls"] = [{"id": text(c.get("id")), "name": text(c.get("name"))}
                               for c in calls if isinstance(c, dict)]
    return result

def project(value, format):
    if not isinstance(value, dict):
        return None
    if format == "gemini-session":
        if "sessionId" in value:
            return {"sessionId": text(value["sessionId"])}
        if isinstance(value.get("$set"), dict):
            source = value["$set"]
            result = {key: text(source[key]) for key in ("sessionId", "lastUpdated") if key in source}
            if isinstance(source.get("messages"), list):
                result["messages"] = [m for m in (gemini_message(v) for v in source["messages"]) if m]
            return {"$set": result}
        return gemini_message(value)
    if format == "kimi-wire":
        message = value.get("message")
        if not isinstance(message, dict):
            return {"model": text(value.get("model"))} if "model" in value else None
        kind, payload = message.get("type"), message.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        if kind not in ("TurnBegin", "StepBegin", "StepRetry", "StatusUpdate"):
            return None
        p = {}
        for key in ("n", "next_attempt"):
            if type(payload.get(key)) is int and payload[key] >= 0:
                p[key] = payload[key]
        for key in ("message_id", "model"):
            if isinstance(payload.get(key), str):
                p[key] = text(payload[key])
        usage = counters(payload.get("token_usage"), ("input_other", "input_cache_read", "input_cache_creation", "output"))
        if usage is not None:
            p["token_usage"] = usage
        at = value.get("timestamp")
        if type(at) not in (int, float) or not 0 < at < 100000000000:
            raise ValueError("timestamp")
        return {"timestamp": at, "message": {"type": kind, "payload": p}}
    if format == "codex-jsonl":
        p = value.get("payload")
        if not isinstance(p, dict):
            return None
        kind = value.get("type")
        fields = {}
        if kind == "session_meta":
            fields = {key: text(p[key]) for key in ("id", "session_id", "parent_thread_id") if isinstance(p.get(key), str)}
            if type(p.get("subagent_history_start_ordinal")) is int:
                fields["subagent_history_start_ordinal"] = p["subagent_history_start_ordinal"]
        elif kind == "turn_context":
            fields = {"model": text(p.get("model"))}
        elif kind == "event_msg" and p.get("type") == "token_count":
            info = p.get("info")
            usage = info.get("total_token_usage") if isinstance(info, dict) else None
            keys = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens")
            projected = counters(usage, keys)
            if projected is None:
                return None
            fields = {"type": "token_count", "info": {"total_token_usage": projected}}
            last = counters(info.get("last_token_usage"), keys)
            if last is not None:
                fields["info"]["last_token_usage"] = last
            # Preserve the original ID if future unknown counter keys exist.
            at = datetime.datetime.fromisoformat(value["timestamp"].replace("Z", "+00:00"))
            if at.tzinfo is None:
                raise ValueError("timestamp")
            epoch = at - datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
            millis = epoch.days * 86400000 + epoch.seconds * 1000 + epoch.microseconds // 1000
            canonical = json.dumps(usage, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
            metric_id = hashlib.sha256(("codex:tokens:" + str(millis) + ":" + canonical).encode()).hexdigest()
        elif kind == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
            fields = {key: text(p[key]) for key in ("type", "id", "call_id", "name") if isinstance(p.get(key), str)}
            call = p.get("call_id", p.get("id"))
            if not isinstance(call, str):
                return None
            metric_id = hashlib.sha256(("codex:tool:" + call).encode()).hexdigest()
        else:
            return None
        result = {"type": kind, "payload": fields, "timestamp": text(value.get("timestamp"))}
        if "metric_id" in locals():
            result["metricId"] = metric_id
        if type(value.get("ordinal")) is int:
            result["ordinal"] = value["ordinal"]
        return result
    if value.get("type") != "assistant" or not isinstance(value.get("message"), dict):
        if value.get("type") == "session_meta":
            return {"type": "session_meta", "sessionId": text(value.get("sessionId"))}
        return None
    original = value["message"]
    message = {key: text(original.get(key)) for key in ("id", "model", "role")}
    usage = counters(original.get("usage"), ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
    if usage is not None:
        message["usage"] = usage
    if isinstance(original.get("content"), list):
        message["content"] = [{"type": "tool_use", "id": text(p.get("id")), "name": text(p.get("name"))}
                              for p in original["content"] if isinstance(p, dict) and p.get("type") == "tool_use"]
    result = {"type": "assistant", "message": message, "timestamp": text(value.get("timestamp"))}
    for key in ("sessionId", "session_id", "access"):
        if key in value:
            result[key] = text(value[key])
    return result

def collect(request):
    home = request.get("home") or os.path.expanduser("~")
    if not isinstance(home, str) or not os.path.isabs(home):
        raise ValueError("home")
    machine = socket.gethostname()
    try:
        with open("/etc/machine-id", encoding="ascii") as f:
            machine = f.read(256).strip() or machine
    except (OSError, UnicodeError):
        pass
    codex_home = os.environ.get("CODEX_HOME") or os.path.join(home, ".codex")
    device = str(uuid.uuid5(uuid.NAMESPACE_URL, "quota:" + machine + ":" + str(getattr(os, "getuid", lambda: 0)()) + ":" + os.path.realpath(request.get("identityRoot") or codex_home)))
    result = {"format": "quota-activity-sources-v1", "deviceId": device, "deviceName": text(socket.gethostname()), "files": [], "errors": [], "partial": False}
    if request.get("mode") == "identity":
        return result
    instances = request.get("instances", [])
    if not isinstance(instances, list) or len(instances) > 32:
        raise ValueError("instances")
    scanned = emitted = 0
    for source in instances:
        software, format = source.get("software"), source.get("format")
        root = source.get("root") or (codex_home if software == "codex" else os.path.join(home, ROOTS.get(software, "")))
        if not isinstance(root, str) or not os.path.isabs(root) or software not in ROOTS:
            result["errors"].append("unsupported-source")
            continue
        if not os.path.exists(root):
            result["errors"].append("source-not-found:" + software)
            continue
        paths = []
        if os.path.isfile(root):
            paths = [root]
        else:
            for directory, folders, names in os.walk(root, followlinks=False):
                depth = len(os.path.relpath(directory, root).split(os.sep))
                folders[:] = [f for f in folders if not os.path.islink(os.path.join(directory, f))] if depth < 12 else []
                for name in names:
                    if format == "kimi-wire" and name != "wire.jsonl":
                        continue
                    if format == "gemini-session" and not name.startswith("session-"):
                        continue
                    if name.endswith(".jsonl") or format == "gemini-session" and name.endswith(".json"):
                        paths.append(os.path.join(directory, name))
        if len(paths) > 10000:
            raise ValueError("files")
        offsets = source.get("offsets", {})
        if not isinstance(offsets, dict) or len(offsets) > 10000:
            raise ValueError("offsets")
        for file in sorted(paths):
            if os.path.islink(file):
                continue
            size = os.path.getsize(file)
            if size > 256 * 1024 * 1024 or scanned >= MAX_SCAN or emitted >= MAX_EVENTS:
                result["partial"] = True
                continue
            relative = os.path.relpath(file, root).replace(os.sep, "/")
            if relative == ".":
                relative = os.path.basename(file)
            events = []
            previous = offsets.get(relative, {})
            start = previous.get("offset", 0) if isinstance(previous, dict) else 0
            if type(start) is not int or start < 0:
                raise ValueError("offset")
            stamp = str(size) + ":" + str(os.stat(file).st_mtime_ns)
            reset = previous.get("reset") is True
            if reset:
                start = 0
            offset = start
            try:
                if file.endswith(".json"):
                    if previous.get("stamp") == stamp:
                        continue
                    scanned += size
                    with open(file, encoding="utf-8") as f:
                        original = json.load(f)
                    value = {key: text(original.get(key)) for key in ("sessionId", "lastUpdated")}
                    value["messages"] = [m for m in (gemini_message(v) for v in original.get("messages", [])) if m]
                    # Whole snapshots contain only message projections. Bound
                    # the record count before transfer, never truncate usage.
                    if len(value["messages"]) > MAX_EVENTS:
                        result["errors"].append("snapshot-too-many-messages:" + software)
                        continue
                    events = [{"$set": value}]
                    reset = True
                    start = 0
                    offset = size
                else:
                    if start > size or start == size and previous.get("stamp") != stamp:
                        start = offset = 0
                        reset = True
                    if start == size:
                        continue
                    with open(file, "rb") as f:
                        f.seek(start)
                        for line in f:
                            if not line.endswith(b"\n"):
                                break
                            if len(line) > MAX_LINE:
                                raise ValueError("line")
                            p = project(json.loads(line), format)
                            if p is not None:
                                events.append(p)
                            offset += len(line)
                            scanned += len(line)
                            if emitted + len(events) >= MAX_EVENTS or scanned >= MAX_SCAN:
                                result["partial"] = True
                                break
                emitted += len(events)
                result["files"].append({"instance": source["id"], "path": relative,
                                        "start": start, "offset": offset, "reset": reset, "stamp": stamp,
                                        "session": text(os.path.basename(os.path.dirname(file))) if format == "kimi-wire" else "",
                                        "events": events})
            except (OSError, ValueError, TypeError):
                result["errors"].append("file-not-readable:" + software)
    result["errors"] = sorted(set(result["errors"]))[:32]
    if len(json.dumps(result, ensure_ascii=False).encode()) > LIMIT:
        raise ValueError("response-size")
    return result

if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("request")
        print(json.dumps(collect(json.loads(raw)), ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    except Exception:
        print('{"error":"projection-failed"}')
        sys.exit(1)
