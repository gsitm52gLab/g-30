#!/usr/bin/env python3
"""Read-only integrity review; never grants product acceptance or reruns tests."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('manifests', nargs='+', type=Path)
parser.add_argument('--candidate')
parser.add_argument('--integration')
args = parser.parse_args()
results = []
errors = []
for manifest in args.manifests:
    document = json.loads(manifest.read_text())
    entries = document.get('artifacts', document.get('files', document.get('entries', [])))
    local_errors = []
    if isinstance(entries, dict):
        entries = [dict(value, path=path) if isinstance(value, dict)
                   else {'path': path, 'sha256': value}
                   for path, value in entries.items()]
    if not entries:
        local_errors.append('manifest has no artifacts')
    if args.candidate:
        candidate_values = [document[key] for key in
                            ('candidate_commit', 'verified_candidate_commit', 'candidate')
                            if key in document]
        if not candidate_values or any(value != args.candidate for value in candidate_values):
            local_errors.append('candidate_commit mismatch')
    if args.integration and document.get('integration_commit') != args.integration:
        local_errors.append('integration_commit mismatch')
    seen = set()
    for entry in entries:
        path = Path(entry['path'])
        if not path.is_absolute():
            local_errors.append(f'non-absolute artifact path: {path}')
            continue
        canonical = str(path.resolve())
        if canonical in seen:
            local_errors.append(f'duplicate artifact: {path}')
        seen.add(canonical)
        if not path.is_file():
            local_errors.append(f'missing artifact: {path}')
            continue
        if digest(path) != entry['sha256']:
            local_errors.append(f'hash mismatch: {path}')
        if 'bytes' in entry and path.stat().st_size != entry['bytes']:
            local_errors.append(f'byte count mismatch: {path}')
    results.append({'manifest': str(manifest.resolve()), 'manifest_sha256': digest(manifest),
                    'artifact_count': len(entries), 'errors': local_errors})
    errors.extend(local_errors)
print(json.dumps({'scope': 'artifact integrity only; semantic review and actual execution still required',
                  'results': results, 'integrity_ok': not errors, 'product_acceptance': 'NOT_EVALUATED'},
                 ensure_ascii=False, indent=2))
raise SystemExit(1 if errors else 0)
