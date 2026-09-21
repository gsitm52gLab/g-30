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
    entries = document.get('artifacts', document.get('files', []))
    local_errors = []
    if not entries:
        local_errors.append('manifest has no artifacts')
    for key, expected in [('candidate_commit', args.candidate), ('integration_commit', args.integration)]:
        observed = document.get(key)
        if key == 'candidate_commit' and observed is None:
            observed = document.get('verified_candidate_commit')
        if expected and observed != expected:
            local_errors.append(f'{key} mismatch')
        if key == 'candidate_commit' and expected and 'verified_candidate_commit' in document:
            if document['verified_candidate_commit'] != expected:
                local_errors.append('verified_candidate_commit mismatch')
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
