"""Read public official pricing documents, without executing page JavaScript."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "target/official-current"
SOURCES = {
    "openai": "https://developers.openai.com/api/docs/pricing.md",
    "kimi": "https://platform.kimi.com/docs/pricing/chat.md",
    "anthropic": "https://platform.claude.com/docs/en/about-claude/pricing.md",
    "deepseek": "https://api-docs.deepseek.com/quick_start/pricing/",
    "zhipu": "https://docs.bigmodel.cn/cn/guide/start/pricing.md",
    "google": "https://ai.google.dev/gemini-api/docs/pricing",
    "xiaomi": "https://mimo.mi.com/docs/price/pay-as-you-go",
    "alibaba": "https://help.aliyun.com/zh/model-studio/model-pricing",
    "xai": "https://docs.x.ai/developers/pricing",
    "meta": "https://dev.meta.ai/docs/pricing-rate-limits",
}


def fetch(item):
    vendor, url = item
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Quota-public-pricing-audit"})
        with urllib.request.urlopen(request, timeout=25) as response:
            data = response.read(6 * 1024 * 1024 + 1)
            if len(data) > 6 * 1024 * 1024:
                raise ValueError("document size limit")
        (OUT / (vendor + ".txt")).write_bytes(data)
        return {"vendor": vendor, "url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    except Exception as error:
        return {"vendor": vendor, "url": url, "error": type(error).__name__}


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(fetch, SOURCES.items()))
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "sources": rows}
    (OUT / "sources.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
