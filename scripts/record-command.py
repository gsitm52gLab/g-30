"""Preserve real command stdout/stderr, actual cwd, and exit code. Never dumps env."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

label, *command = sys.argv[1:]
if command and command[0] == '--':
    command = command[1:]
if not command:
    raise SystemExit('Usage: record-command.py LABEL -- COMMAND ...')
root = Path(os.environ.get('EVIDENCE_ROOT', '.local/g00-evidence')).resolve()
root.mkdir(parents=True, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
stem = root / (stamp + '-' + label)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with stem.with_suffix('.log').open('w') as output:
    result = subprocess.run(command, cwd=Path.cwd(), stdout=output, stderr=subprocess.STDOUT)
finished = datetime.datetime.now(datetime.timezone.utc).isoformat()
log = stem.with_suffix('.log')
metadata = {'check_id': label, 'command': command, 'cwd': str(Path.cwd()), 'started_at': started,
            'finished_at': finished, 'exit_code': result.returncode, 'report_path': str(log),
            'report_sha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'level': 'implementer-self-check'}
stem.with_suffix('.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
print(json.dumps(metadata, ensure_ascii=False))
print(log.read_text()[-18000:])
sys.exit(result.returncode)
