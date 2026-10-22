# v0.1.1
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import hashlib
import json

# MilestoneFactory + Delivery Record.
#
# The factory holds ONE audited copy of the MilestoneOracle source and deploys every milestone
# itself (gl.deploy_contract), naming the real caller as the funder. Because it only counts
# milestones it deployed, a look-alike contract cannot write itself into the record.
#
# The Delivery Record is a public, per-builder history of FINALIZED verdicts. Anyone may call
# record(milestone) once a milestone is FINALIZED; the factory then re-reads the milestone's
# finalized state (and its last history row) and stores a compact summary. Nothing in the record
# is typed in by a person: it is read from the milestone contracts.
#
# Holds no funds. A record says "these public checks held (or did not) for this milestone". It
# does not say the work was good, that the funder was honest, or that the builder is one person.

MAX_PER_BUILDER = 100
MAX_PAGE = 50
VERDICTS = ("MET", "NOT_MET")


def _address(text) -> str:
    if (not isinstance(text, str) or len(text) != 42 or text[:2] not in ("0x", "0X")
            or any(c not in "0123456789abcdefABCDEF" for c in text[2:])):
        raise gl.vm.UserError("invalid address")
    return text.lower()


def _sha256_hex(text: str) -> str:
    return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()


class MilestoneFactory(gl.Contract):
    """Deploys MilestoneOracle contracts and keeps their public delivery record."""
    deployer: str
    milestone_code: str
    code_sha256: str
    count: u32
    milestones: TreeMap[u32, str]
    created: TreeMap[str, str]
    by_builder: TreeMap[str, str]
    records: TreeMap[str, str]
    recorded_count: u32

    def __init__(self, milestone_code: str):
        if (not isinstance(milestone_code, str) or "class MilestoneOracle" not in milestone_code
                or len(milestone_code) > 200000):
            raise gl.vm.UserError("milestone code missing or too large")
        self.deployer = str(gl.message.sender_address).lower()
        self.milestone_code = milestone_code
        self.code_sha256 = _sha256_hex(milestone_code)
        self.count = u32(0)
        self.recorded_count = u32(0)

    # -- create ------------------------------------------------------------------

    @gl.public.write
    def create_milestone(self, builder_address: str, title: str, deadline_date: str,
                         checks_json: str, challenge_window_seconds: int) -> str:
        funder = str(gl.message.sender_address).lower()
        builder = _address(builder_address)
        if builder == funder:
            raise gl.vm.UserError("builder must differ from funder")
        existing = json.loads(self.by_builder[builder]) if builder in self.by_builder else []
        if len(existing) >= MAX_PER_BUILDER:
            raise gl.vm.UserError("builder list is full")
        index = int(self.count)
        address = gl.deploy_contract(
            code=self.milestone_code.encode("utf-8"),
            args=[builder, title, deadline_date, checks_json, challenge_window_seconds, funder],
            salt_nonce=u256(index + 1),
        )
        child = address.as_hex.lower()
        self.milestones[u32(index)] = child
        self.created[child] = json.dumps({
            "index": index, "funder": funder, "builder": builder, "title": title.strip(),
        }, sort_keys=True, ensure_ascii=False)
        existing.append(child)
        self.by_builder[builder] = json.dumps(existing)
        self.count = u32(index + 1)
        return child

    # -- record ------------------------------------------------------------------

    @gl.public.write
    def record(self, milestone_address: str) -> str:
        child = _address(milestone_address)
        if child not in self.created:
            raise gl.vm.UserError("not a milestone of this factory")
        if child in self.records:
            raise gl.vm.UserError("already recorded")
        info = json.loads(self.created[child])
        # Read the milestone with the default view. On Studionet a read pinned to the "latest final"
        # state did not answer (probe, 2026-10-21: default 1.3 s, nonfinal 1.6 s, final timed out), so
        # the record trusts the milestone's own FINALIZED phase, which only a finished round can reach.
        proxy = gl.get_contract_at(Address(child))
        state = json.loads(proxy.view().get_state_json())
        if int(state.get("finalized", 0)) != 1 or state.get("phase") != "FINALIZED":
            raise gl.vm.UserError("milestone is not FINALIZED")
        verdict = state.get("final_verdict")
        if verdict not in VERDICTS:
            raise gl.vm.UserError("final verdict is not MET or NOT_MET")
        if (state.get("builder") != info["builder"] or state.get("funder") != info["funder"]
                or state.get("title") != info["title"]):
            raise gl.vm.UserError("milestone does not match its creation record")
        history_count = int(state.get("history_count", 0))
        if history_count < 1:
            raise gl.vm.UserError("milestone has no history")
        last = json.loads(proxy.view().get_history_json(history_count - 1))
        if last.get("action") != "FINALIZE" or last.get("verdict") != verdict:
            raise gl.vm.UserError("last history row is not the matching FINALIZE")
        summary = {
            "milestone": child,
            "builder": info["builder"],
            "funder": info["funder"],
            "title": info["title"],
            "deadline_date": state.get("deadline_date"),
            "verdict": verdict,
            "round": int(state.get("final_round", 0)),
            "amendments": int(state.get("amendments", 0)),
            "history_count": history_count,
            "finalized_at": int(last.get("timestamp", 0)),
            "checks": state.get("latest_results", {}),
            "check_count": len(state.get("checks", [])),
        }
        self.records[child] = json.dumps(summary, sort_keys=True, ensure_ascii=False)
        self.recorded_count = u32(int(self.recorded_count) + 1)
        return verdict

    # -- views -------------------------------------------------------------------

    @gl.public.view
    def get_factory_info(self) -> str:
        return json.dumps({
            "deployer": self.deployer, "code_sha256": self.code_sha256,
            "code_length": len(self.milestone_code), "milestones": int(self.count),
            "recorded": int(self.recorded_count),
        }, sort_keys=True)

    @gl.public.view
    def get_milestone_count(self) -> int:
        return int(self.count)

    @gl.public.view
    def get_milestone_at(self, index: int) -> str:
        if type(index) is not int or index < 0 or index >= int(self.count):
            raise gl.vm.UserError("index out of range")
        return self.milestones[u32(index)]

    @gl.public.view
    def get_milestones_page(self, offset: int, limit: int) -> str:
        if type(offset) is not int or type(limit) is not int or offset < 0 or not 1 <= limit <= MAX_PAGE:
            raise gl.vm.UserError("bad page")
        total = int(self.count)
        end = min(total, offset + limit)
        rows = []
        for i in range(offset, end):
            child = self.milestones[u32(i)]
            row = json.loads(self.created[child])
            row["milestone"] = child
            row["recorded"] = child in self.records
            rows.append(row)
        return json.dumps({"total": total, "offset": offset, "items": rows}, sort_keys=True,
                          ensure_ascii=False)

    @gl.public.view
    def is_factory_milestone(self, milestone_address: str) -> bool:
        return _address(milestone_address) in self.created

    @gl.public.view
    def get_record(self, milestone_address: str) -> str:
        child = _address(milestone_address)
        return self.records[child] if child in self.records else "NONE"

    @gl.public.view
    def get_builder_summary(self, builder_address: str) -> str:
        builder = _address(builder_address)
        children = json.loads(self.by_builder[builder]) if builder in self.by_builder else []
        met = 0
        not_met = 0
        amended = 0
        rows = []
        for child in children:
            if child not in self.records:
                continue
            rec = json.loads(self.records[child])
            if rec["verdict"] == "MET":
                met += 1
            else:
                not_met += 1
            if rec["amendments"] > 0:
                amended += 1
            rows.append({"milestone": child, "title": rec["title"], "verdict": rec["verdict"],
                         "finalized_at": rec["finalized_at"], "amendments": rec["amendments"],
                         "funder": rec["funder"]})
        return json.dumps({
            "builder": builder, "created": len(children), "recorded": len(rows),
            "met": met, "not_met": not_met, "with_amendments": amended, "milestones": rows,
        }, sort_keys=True, ensure_ascii=False)

    @gl.public.view
    def export_feedback(self, milestone_address: str) -> str:
        """An ERC-8004-SHAPED feedback signal for one recorded milestone.

        This only reuses the field names of the draft reputation registry (value, valueDecimals,
        tag1, tag2, endpoint, feedbackHash). Nothing is written to any ERC-8004 registry, and
        the 100/0 mapping is this project's own convention (100 = MET, 0 = NOT_MET)."""
        child = _address(milestone_address)
        if child not in self.records:
            raise gl.vm.UserError("milestone is not recorded")
        raw = self.records[child]
        rec = json.loads(raw)
        return json.dumps({
            "shape": "ERC-8004 reputation feedback (fields only, not written to any registry)",
            "subject": rec["builder"], "value": 100 if rec["verdict"] == "MET" else 0,
            "valueDecimals": 0, "tag1": "milestone", "tag2": "delivery",
            "endpoint": child, "feedbackHash": _sha256_hex(raw),
        }, sort_keys=True)
