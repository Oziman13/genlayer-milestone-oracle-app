"""NOTE: needs a local checkout of the removed standalone v0.1.0 repository next to this one (../genlayer-milestone-oracle); it is no longer published.

Run four representative historical mutations on disposable copies, never on the original checkout.

Run using the prepared Python interpreter and PYTHONPATH setup. Not a rerun of all 26 historical mutants.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

original = Path(__file__).resolve().parents[2] / "genlayer-milestone-oracle"
source = (original / "contracts/milestone_oracle.py").read_text()
mutants = [
    ("late release accepted", 'return "PASS" if stamp <= deadline_ts else "LATE"', 'return "PASS"', "test_release_check"),
    ("finalize skips comparison", 'if verdict == self.candidate:', 'if True:', "test_evidence_that_vanishes_during_the_window_cannot_be_finalized"),
    ("finalize inside window", 'if now < int(self.window_end):', 'if False:', "test_finalize_refused_while_window_open"),
    ("nonfinal attestation leaked", 'return self.final_verdict if self.phase == "FINALIZED" else "NONE"', 'return self.latest_verdict', "test_evidence_that_vanishes_during_the_window_cannot_be_finalized"),
]
for label, old, new, test in mutants:
    assert source.count(old) == 1, (label, "mutation anchor changed")
    with tempfile.TemporaryDirectory(prefix="mo-mutation-") as directory:
        root = Path(directory)
        shutil.copytree(original / "contracts", root / "contracts")
        shutil.copytree(original / "tests", root / "tests")
        (root / "contracts/milestone_oracle.py").write_text(source.replace(old, new))
        result = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                                 f"tests/direct/test_milestone_oracle.py::{test}"], cwd=root,
                                text=True, capture_output=True)
        killed = result.returncode == 1 and "FAILED tests/direct/" in result.stdout and "ERROR tests/" not in result.stdout
        print(f"{label}: {'KILLED' if killed else 'UNEXPECTED RESULT'}", flush=True)
        if not killed:
            print(result.stdout, result.stderr)
            sys.exit(1)
print("4 of 4 representative mutants killed; original files untouched")
