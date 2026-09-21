#!/usr/bin/env python3
"""Export allowlisted metadata from verified actual session prefixes, never a full transcript."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('manifest', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
manifest_bytes = args.manifest.read_bytes()
manifest = json.loads(manifest_bytes)
args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
name_pattern = re.compile(r'[A-Za-z][A-Za-z0-9_.:/-]{0,159}\Z')
time_pattern = re.compile(r'\d{4}-\d\d-\d\dT[\d:.+Z-]{8,40}\Z')
allowed_roles = {'user', 'assistant', 'system', 'developer', 'tool'}
reports = []
for source in manifest['logs']:
    session_id = source['session_id']
    if not re.fullmatch(r'[a-f0-9-]{36}', session_id):
        raise ValueError('Unexpected session ID format')
    data = Path(source['archive_path']).read_bytes()
    prefix_hash = hashlib.sha256(data).hexdigest()
    if len(data) != source['archive_bytes'] or prefix_hash != source['archive_sha256']:
        raise ValueError('Actual archived source prefix failed integrity verification')
    target = args.output / (session_id + '.metadata.jsonl')
    counts = collections.Counter()
    excluded_incomplete_tail = 0
    with target.open('xb') as out:
        os.chmod(target, 0o600)
        for number, line in enumerate(data.splitlines(keepends=True), 1):
            if not line.endswith(b'\n'):
                excluded_incomplete_tail += len(line)
                continue
            raw = json.loads(line)
            kind = raw.get('type')
            row = {'derivative_kind': 'metadata_only_not_transcript',
                   'session_id': session_id, 'original_line_number': number,
                   'original_record_sha256': hashlib.sha256(line).hexdigest()}
            if isinstance(kind, str) and name_pattern.fullmatch(kind):
                row['record_type'] = kind
                counts[kind] += 1
            timestamp = raw.get('timestamp')
            if isinstance(timestamp, str) and time_pattern.fullmatch(timestamp):
                row['timestamp'] = timestamp
            payload = raw.get('payload')
            if isinstance(payload, dict):
                event_type = payload.get('type')
                if isinstance(event_type, str) and name_pattern.fullmatch(event_type):
                    row['event_type'] = event_type
                role = payload.get('role')
                if role in allowed_roles:
                    row['role'] = role
                # Function identity only: arguments, output, messages, text, locations and IDs are omitted.
                tool = payload.get('name')
                if event_type in {'function_call', 'custom_tool_call'} and isinstance(tool, str) and name_pattern.fullmatch(tool):
                    row['tool_name'] = tool
            out.write((json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
    derivative = target.read_bytes()
    reports.append({'session_id': session_id, 'source_prefix_sha256': prefix_hash,
                    'source_prefix_bytes': len(data), 'derivative_file': target.name,
                    'derivative_sha256': hashlib.sha256(derivative).hexdigest(),
                    'derivative_bytes': len(derivative), 'record_count': derivative.count(b'\n'),
                    'record_types': dict(counts), 'excluded_incomplete_tail_bytes': excluded_incomplete_tail})
result = {'kind': 'sanitized_metadata_derivative_not_original_session_log',
          'source_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
          'source_scope': 'Actual archived growing prefixes; later session records are outside this export.',
          'retained': ['session_id', 'original_line_number', 'original_record_sha256', 'timestamp', 'record_type', 'event_type', 'role', 'tool_name'],
          'omitted': ['all text and message content', 'tool arguments and outputs', 'environment and credentials', 'filesystem paths', 'URLs', 'user/business documents', 'raw model or tool payloads'],
          'limits': 'These files prove recorded event metadata only. They do not reproduce the conversation, command results or product verification. Originals remain private and separate. No public transmission is performed.',
          'sessions': reports}
(args.output / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
os.chmod(args.output / 'manifest.json', 0o600)
(args.output / 'README.md').write_text('''# 제출 검토용 세션 메타데이터 사본

실제 원본 세션의 보존된 구간에서 허용된 메타데이터만 추출한 비식별 파생본입니다. 전체 대화나 원본 JSONL이 아닙니다. 각 줄에 원본 세션 ID·줄 번호·원본 줄 SHA-256을 남겨 비공개 원본과 대조할 수 있습니다.

대화 본문, 도구 인자·결과, 환경값, 파일 경로, URL과 업무 자료는 복사하지 않았습니다. 따라서 이 사본만으로 명령 성공이나 제품 검증을 입증할 수 없습니다. 실제 검증은 별도의 후보별 증거 패킷을 확인해야 합니다. 계속 실행되는 세션의 이후 기록은 다음 보존 시점에 추가로 수집해야 합니다.

원본은 별도 비공개 보관합니다. 이 작업은 외부 제출이나 공개를 수행하지 않습니다.
''')
os.chmod(args.output / 'README.md', 0o600)
print(json.dumps({'output': str(args.output), 'sessions': len(reports),
                  'records': sum(r['record_count'] for r in reports),
                  'manifest_sha256': hashlib.sha256((args.output / 'manifest.json').read_bytes()).hexdigest()}))
