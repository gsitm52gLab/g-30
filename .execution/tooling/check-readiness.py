#!/usr/bin/env python3
"""Read-only completion guard. Evidence existence never substitutes for semantic review."""
import argparse
import collections
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--require-complete', action='store_true')
args = parser.parse_args()
root = args.root.resolve()


def read(path):
    return json.loads((root / path).read_text())


state = read('.execution/run-plan.json')
baseline = read('docs/execution-v1/04-run-plan.json')
trace = read('.execution/traceability.json')
scope = read('.execution/scope-checklist.json')['items']
deferred = read('.execution/deferred-checks.json')['checks']
errors, pending = [], []


def index(rows, expected, label):
    counts = collections.Counter(row['id'] for row in rows)
    if set(counts) != set(expected) or any(n != 1 for n in counts.values()):
        errors.append({'group': label, 'missing': sorted(set(expected) - set(counts)),
                       'extra': sorted(set(counts) - set(expected)),
                       'duplicates': sorted(k for k, n in counts.items() if n != 1)})
    return {row['id']: row for row in rows}


def evidence(row, label):
    refs = row.get('evidence', [])
    if not refs:
        errors.append({'id': label, 'error': 'PASS requires evidence references'})
    for ref in refs:
        path = ref.get('path') if isinstance(ref, dict) else ref
        if not isinstance(path, str) or not (root / path).is_file():
            errors.append({'id': label, 'error': 'missing evidence', 'path': path})


def completion_rows(rows, label):
    for row in rows:
        if row.get('status') != 'PASS':
            pending.append({'id': row['id'], 'group': label, 'status': row.get('status')})
        else:
            evidence(row, row['id'])


tasks = index(state['tasks'], [f'G{i:02}' for i in range(19)], 'goals')
for original in baseline['tasks']:
    task = tasks.get(original['id'])
    if not task:
        continue
    for field in ['prd_id', 'dependencies', 'required_for_product_completion']:
        if task.get(field) != original[field]:
            errors.append({'id': task['id'], 'error': f'baseline {field} changed; explicit review required'})
    acs = index(task['acceptance'], [a['id'] for a in original['acceptance']], task['id'])
    for a in original['acceptance']:
        if a['id'] in acs and acs[a['id']].get('expected') != a['expected']:
            errors.append({'id': a['id'], 'error': 'baseline criterion changed; explicit review required'})
    completion_rows(task['acceptance'], 'acceptance')
    if task['state'] != 'ACCEPTED':
        pending.append({'id': task['id'], 'group': 'goal', 'status': task['state']})
        continue
    implementers = task.get('implementer_session_ids', [task.get('implementer_session_id')])
    if not all(implementers) or not task.get('verifier_session_id') or task['verifier_session_id'] in implementers:
        errors.append({'id': task['id'], 'error': 'missing independent session IDs'})
    for field in ['candidate_commit', 'integration_commit', 'verification_result', 'regression_result']:
        value = task.get(field)
        if not value or (field.endswith('_result') and not (root / value).is_file()):
            errors.append({'id': task['id'], 'error': f'missing {field}'})

for rows, ids, label in [
    (trace['original_criteria'], [f'A{i:02}' for i in range(1, 27)], 'original criteria'),
    (trace['ai_evaluations'], [f'AI-E{i:02}' for i in range(1, 14)], 'AI evaluations'),
    (scope, [f'SA-{i:02}' for i in range(1, 65)], 'source scope'),
    (deferred, [f'D{i:02}' for i in range(1, 11)], 'deferred integration'),
]:
    index(rows, ids, label)
    completion_rows(rows, label)
for row in deferred:
    completion_rows(row.get('check_groups', []), 'deferred producer/consumer groups')
completion_rows([r for r in trace['external_levels'] if r.get('required_for_goal')], 'required external integration')
final = tasks.get('G18', {})
if final.get('state') == 'ACCEPTED' and final.get('integration_commit') != state.get('accepted_commit'):
    errors.append({'id': 'G18', 'error': 'final audited integration SHA differs from accepted SHA'})
report = {
    'state_version': state['state_version'],
    'accepted_commit': state.get('accepted_commit'),
    'accepted_checkpoints': sum(t['state'] == 'ACCEPTED' for t in tasks.values()),
    'total_checkpoints': 19,
    'total_acceptance_criteria': sum(len(t['acceptance']) for t in tasks.values()),
    'integrity_errors': errors,
    'pending': pending,
    'ready_for_final_semantic_audit': not errors and not pending,
    'limits': 'Read-only tracking guard. Does not execute product tests, validate evidence contents, or mark the active Goal complete. Stage-specific PASS remains pending for final completion; operational-only limitations are separate.',
}
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(1 if errors or (args.require_complete and pending) else 0)
