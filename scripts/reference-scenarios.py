"""Independent source reader/reference fit. Never executes downloaded code.

The Rust adapter is checked against this separate CSV/ZIP implementation.
All writes stay in target/; public source data contains no Quota user data.
"""
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / 'src-tauri/data/benchmark-policy.json').read_text(encoding='utf-8'))


def key(value):
    return ''.join(c.lower() for c in value if c.isascii() and c.isalnum())


def load(path):
    with zipfile.ZipFile(path) as archive:
        def rows(name):
            return list(csv.DictReader(io.StringIO(archive.read(name).decode('utf-8-sig'))))
        models = {r['Model']: r for r in rows('epoch_capabilities_index/eci_scores.csv')}
        versions = {r['model_version']: r for r in rows('model_metadata.csv') if r['model_version']}
        curves = {r['benchmark_name']: r for r in rows('epoch_capabilities_index/edi_scores.csv')}
        metadata = {r['benchmark']: r for r in rows('benchmark_metadata.csv') if r['in_eci'] == 'True'}
        scores = {}
        conflicts = set()
        for name, cfg in metadata.items():
            if name not in curves:
                continue
            for row in rows(cfg['source_file']):
                version = row.get('Model version', '')
                model = versions.get(version, {}).get('model_group', '')
                if model not in models:
                    continue
                try:
                    raw = float(row[cfg['score_column']]) * float(cfg['scale'])
                    p = min(1, max(0, (raw - float(cfg['random_baseline'])) / (float(cfg['score_ceiling']) - float(cfg['random_baseline']))))
                except (ValueError, TypeError, ZeroDivisionError):
                    continue
                if not math.isfinite(raw):
                    continue
                identifier = (model, version, name)
                if identifier in scores and abs(scores[identifier]['raw'] - raw) > 1e-10:
                    conflicts.add(identifier)
                scores[identifier] = {'model': model, 'version': version, 'benchmark': name, 'p': p, 'raw': raw, 'source': row.get('Source', '')}
        for identifier in conflicts:
            scores.pop(identifier, None)
        # Apply the publisher's version supersession within a complete config.
        for identifier in list(scores):
            model, version, name = identifier
            replacement = metadata[name]['superseded_by']
            if replacement and (model, version, replacement) in scores:
                del scores[identifier]
        return models, curves, list(scores.values()), len(conflicts)


def loss(c, values, curves):
    total = 0
    for value in values:
        curve = curves[value['benchmark']]
        z = max(-700, min(700, float(curve['estimated_slope_scaled']) * (c - float(curve['edi']))))
        total += (1 / (1 + math.exp(-z)) - value['p']) ** 2
    return total / len(values)


def fit(values, curves, step=0.25):
    # Independently bracket every local minimum; refine all of them by a
    # ternary search. Do not assume a multi-benchmark squared loss is convex.
    values_at = [loss(i * step, values, curves) for i in range(round(250 / step) + 1)]
    candidates = [(values_at[0], 0.0), (values_at[-1], 250.0)]
    for i in range(1, len(values_at) - 1):
        if values_at[i] <= values_at[i - 1] and values_at[i] <= values_at[i + 1]:
            low, high = (i - 1) * step, (i + 1) * step
            for _ in range(48):
                a, b = (2 * low + high) / 3, (low + 2 * high) / 3
                if loss(a, values, curves) <= loss(b, values, curves):
                    high = b
                else:
                    low = a
            c = (low + high) / 2
            candidates.append((loss(c, values, curves), c))
    error, score = min(candidates)
    return None if score <= 0.001 or score >= 249.999 else (score, math.sqrt(error))


def reference(path):
    models, curves, records, conflicts = load(path)
    used = set(b for d in POLICY['domains'] for b in d['benchmarks'])
    configurations = {}
    for record in records:
        if record['benchmark'] in used:
            configurations.setdefault(record['model'], {}).setdefault(record['version'], []).append(record)
    efforts = {'max': 7, 'xhigh': 6, 'high': 5, 'medium': 4, 'reasoning': 3, 'low': 2, 'none': 1}
    chosen = {}
    for model, versions in configurations.items():
        version = min(versions, key=lambda v: (-len(versions[v]), -efforts.get(v.rsplit('_', 1)[-1], 0), v))
        chosen[model] = version
    output = {'zipSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'general': [], 'scenarios': {}, 'conflictingRecordsExcluded': conflicts}
    for model, row in models.items():
        output['general'].append({'modelId': key(model), 'name': model, 'score': float(row['eci']), 'low': float(row['eci_ci_low']) if row['eci_ci_low'] else None, 'high': float(row['eci_ci_high']) if row['eci_ci_high'] else None})
    for domain in POLICY['domains']:
        result = []
        for model, versions in configurations.items():
            version = chosen[model]
            observations = [r for r in versions[version] if r['benchmark'] in domain['benchmarks']]
            if len(observations) < POLICY['minimumBenchmarks']:
                continue
            fitted = fit(observations, curves)
            if fitted:
                result.append({'modelId': key(model), 'name': model, 'profile': version, 'score': fitted[0], 'rmse': fitted[1], 'benchmarks': len(observations)})
        output['scenarios'][domain['id']] = sorted(result, key=lambda r: (-r['score'], r['modelId']))
    return output


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    output = reference(ROOT / 'target/epoch-research/benchmark_data.zip')
    target = ROOT / 'target/epoch-research/reference.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print('General:', len(output['general']), 'conflicting triples excluded:', output['conflictingRecordsExcluded'])
    for name, rows in output['scenarios'].items():
        print(name, len(rows), [(r['name'], round(r['score'], 2), r['benchmarks'], r['profile']) for r in rows[:7]])
