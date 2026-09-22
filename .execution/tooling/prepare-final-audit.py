#!/usr/bin/env python3
"""Prepare a requirement-by-requirement final audit worksheet, never award PASS."""
import argparse
import collections
import datetime
import hashlib
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
args = parser.parse_args()
root = args.root.resolve()
inputs = {}


def read(name):
    data = (root / name).read_bytes()
    inputs[name] = hashlib.sha256(data).hexdigest()
    return json.loads(data)


state = read('.execution/run-plan.json')
trace = read('.execution/traceability.json')
scope = read('.execution/scope-checklist.json')
deferred = read('.execution/deferred-checks.json')
rows, errors = [], []


def add(group, item, owners=()):
    refs = []
    for raw in item.get('evidence', []):
        path = raw.get('path') if isinstance(raw, dict) else raw
        if not isinstance(path, str):
            errors.append({'id': item['id'], 'reason': 'invalid evidence reference'})
            continue
        target = root / path
        if not target.is_file():
            errors.append({'id': item['id'], 'reason': 'missing evidence', 'path': path})
            continue
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if isinstance(raw, dict) and raw.get('sha256') not in (None, digest):
            errors.append({'id': item['id'], 'reason': 'evidence hash mismatch', 'path': path})
        refs.append({'path': str(target), 'sha256_at_preparation': digest})
    rows.append({
        'group': group, 'id': item['id'], 'owners': list(owners),
        'requirement': item.get('expected', item.get('requirement', item.get('scenario', item['id']))),
        'prior_tracking_status': item.get('status'), 'prior_evidence': refs,
        'prior_notes': {k: v for k, v in item.items() if k in ('remaining', 'scope_note', 'verification_idea', 'scenario') or k.startswith('current_')},
        'final_audit_status': 'NOT_EVALUATED', 'final_candidate': None,
        'semantic_assertions_reviewed': [], 'fresh_execution_evidence': [],
        'source_bound_prior_proof': [], 'open_defects_or_limitations': [],
    })


for task in state['tasks']:
    for ac in task['acceptance']:
        add('PRD acceptance', ac, [task['id']])
for item in trace['original_criteria']:
    add('original criterion', item, item.get('primary_goals', []))
for item in trace['ai_evaluations']:
    add('AI evaluation perspective', item, ['G15', 'G16', 'G17', 'G18'])
for item in scope['items']:
    add('source scope', item, item.get('owners', []))
for item in deferred['checks']:
    add('deferred integration', item, item.get('required_in', []))
    for child in item.get('check_groups', []):
        add('deferred producer/consumer group', child, item.get('required_in', []))
for item in trace['external_levels']:
    if item.get('required_for_goal'):
        add('mandatory external integration', item, ['G17', 'G18'])

counts = collections.Counter(row['group'] for row in rows)
expected = {'PRD acceptance': 91, 'original criterion': 26,
            'AI evaluation perspective': 13, 'source scope': 64,
            'deferred integration': 10, 'mandatory external integration': 1}
for group, count in expected.items():
    if counts[group] != count:
        errors.append({'group': group, 'expected': count, 'actual': counts[group]})
keys = [(row['group'], row['id']) for row in rows]
if len(keys) != len(set(keys)):
    errors.append({'reason': 'duplicate requirement rows'})
report = {
    'kind': 'audit_worksheet_not_execution_or_acceptance',
    'prepared_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'state_version': state['state_version'], 'accepted_product_at_preparation': state.get('accepted_commit'),
    'source_hashes': inputs, 'row_counts': dict(counts), 'integrity_errors': errors,
    'instructions': [
        'Regenerate from the final state before audit; this worksheet does not change the ledger.',
        'Review each requirement in both directions against concrete behavior and actual assertions.',
        'Reuse unchanged prior proof only with exact source binding, original verifier/session/command references and fresh count zero.',
        'A path or PASS string is not semantic evidence. Retain FAIL, SKIP and NOT_RUN explicitly.',
        'Mandatory actual configured OpenAI success is separate from synthetic/fault tests and cannot be deferred as an operational limitation.',
        'Final source must be the independently audited integration SHA; record product, API and operational levels separately.',
    ],
    'checkpoints': [{k: task.get(k) for k in ('id', 'state', 'candidate_commit', 'integration_commit', 'implementer_session_id', 'implementer_session_ids', 'verifier_session_id')} for task in state['tasks']],
    'requirements': rows,
    'operational_only': [item for item in trace['external_levels'] if not item.get('required_for_goal')],
}
args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
with args.output.open('x') as out:
    os.chmod(args.output, 0o600)
    json.dump(report, out, ensure_ascii=False, indent=2)
    out.write('\n')
print(json.dumps({'output': str(args.output.resolve()), 'rows': len(rows),
                  'counts': dict(counts), 'errors': errors,
                  'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
                  'product_tests_executed': 0, 'acceptance_claims': 0}, ensure_ascii=False))
raise SystemExit(1 if errors else 0)
