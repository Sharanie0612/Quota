"""Download public benchmark source documents for deterministic adapter QA."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re
import urllib.request

OUT = Path(__file__).resolve().parents[1] / "target/benchmark-sources"
SOURCES = {
    "artificial-analysis": "https://artificialanalysis.ai/leaderboards/models",
    "aa-method": "https://artificialanalysis.ai/methodology/intelligence-benchmarking",
    "aa-index": "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index",
    "aa-index-v5": "https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5/",
    "model-releases": "https://artificialanalysis.ai/models/releases",
    "livebench": "https://livebench.ai/",
    "epoch-ai": "https://epoch.ai/data/benchmark_data.zip",
}

def fetch(item):
    name, url = item
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Quota-public-benchmark-audit"})
        with urllib.request.urlopen(request, timeout=40) as response:
            data = response.read(16 * 1024 * 1024 + 1)
            if len(data) > 16 * 1024 * 1024:
                raise ValueError("source size limit")
        if name == 'epoch-ai':
            target = OUT.parent / 'epoch-research' / 'benchmark_data.zip'
            target.parent.mkdir(parents=True, exist_ok=True)
        else:
            target = OUT / (name + '.html')
        target.write_bytes(data)
        return {"id": name, "url": url, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    except Exception as error:
        return {"id": name, "url": url, "error": str(error)}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = list(pool.map(fetch, SOURCES.items()))
    if any('error' in entry for entry in result):
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit('Required public source could not be fetched; old fixtures were not promoted')
    index = (OUT / 'livebench.html').read_text(encoding='utf-8')
    asset = re.search(r'src="(\./static/js/main\.[a-zA-Z0-9_-]+\.js)"', index)
    if not asset:
        raise ValueError('LiveBench version entry changed')
    request = urllib.request.Request('https://livebench.ai/' + asset[1].removeprefix('./'), headers={'User-Agent':'Mozilla/5.0 Quota-public-benchmark-audit'})
    with urllib.request.urlopen(request, timeout=40) as response:
        script = response.read(4 * 1024 * 1024 + 1)
    if len(script) > 4 * 1024 * 1024:
        raise ValueError('LiveBench script too large')
    (OUT / 'livebench.js').write_bytes(script)
    releases = sorted({date for match in re.findall(r'\["\d{8}"(?:,"\d{8}")*\]', script.decode('utf-8')) for date in json.loads(match) if date <= datetime.now(timezone.utc).strftime('%Y%m%d')})
    if not releases:
        raise ValueError('LiveBench release IDs missing')
    release = releases[-1]
    for name in ['table.csv','categories.json']:
        url = f'https://livebench.ai/data/{release}/{name}'
        request = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 Quota-public-benchmark-audit'})
        with urllib.request.urlopen(request, timeout=40) as response:
            data = response.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise ValueError('LiveBench data too large')
        (OUT / ('livebench-current-' + name)).write_bytes(data)
        result.append({'id':'livebench-' + name,'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    (OUT / 'livebench-release.txt').write_text(release, encoding='utf-8')
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "sources": result}
    (OUT / "sources.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
