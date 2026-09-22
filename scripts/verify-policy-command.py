"""Record G02 command evidence without dumping the process environment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("label")
parser.add_argument("--requirements", required=True)
parser.add_argument("--level", required=True)
parser.add_argument("command", nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command
if command and command[0] == "--":
    command = command[1:]
if not command:
    parser.error("command is required")
root = Path(os.environ["EVIDENCE_ROOT"]).resolve() / "commands"
root.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
output = root / f"{stamp}-{args.label}.log"
started = datetime.now(timezone.utc).isoformat()
with output.open("w") as stream:
    process = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, cwd=Path.cwd())
result = {
    "label": args.label, "requirements": args.requirements.split(","), "level": args.level,
    "command": command, "cwd": str(Path.cwd()), "started_at": started,
    "finished_at": datetime.now(timezone.utc).isoformat(), "exit_code": process.returncode,
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "stdout_stderr": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "counts": {"unit": "command", "pass": int(process.returncode == 0), "fail": int(process.returncode != 0), "skip": 0, "not_run": 0},
}
metadata = output.with_suffix(".json")
metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False))
raise SystemExit(process.returncode)
