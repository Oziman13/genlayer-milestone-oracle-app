"""MilestoneFactory + Delivery Record: integration tests on a local GenLayer network (glsim).

These tests run real contract-to-contract calls (gl.deploy_contract, gl.get_contract_at) that the
in-memory direct mode cannot run. Web access is mocked; no model is involved (GITHUB_RELEASE only).
Each test starts its own simulator because glsim cannot deploy the same contract file twice.
"""

import hashlib
import json
import os

import pytest

from rpc import ROOT, RpcError, Sim

FUNDER = "0x1111111111111111111111111111111111111111"
BUILDER = "0x2222222222222222222222222222222222222222"
STRANGER = "0x3333333333333333333333333333333333333333"
BUILDER2 = "0x4444444444444444444444444444444444444444"
TITLE = "Ship v1.0 of the Example Toolkit"
DEADLINE = "2026-11-30"
T_BEFORE = "2026-11-10T12:00:00Z"
T_BEFORE_LATER = "2026-11-10T12:20:00Z"
T_AFTER = "2026-12-05T12:00:00Z"
T_AFTER_LATER = "2026-12-05T12:20:00Z"
WINDOW = 300
REPO = "example-org/toolkit"
CHECKS = [{"id": "release", "kind": "GITHUB_RELEASE", "repo": REPO, "tag": "v1.0.0"}]


CHECKS2 = [{"id": "release", "kind": "GITHUB_RELEASE", "repo": REPO, "tag": "v2.0.0"}]


def release_url(tag):
    return "^https://api\\.github\\.com/repos/example-org/toolkit/releases/tags/" + tag.replace(".", "\\.") + "$"


def release_ok(tag):
    return {"status": 200, "body": json.dumps({"tag_name": tag, "draft": False, "prerelease": False,
                                               "published_at": "2026-11-20T10:00:00Z"})}


MISSING = {"status": 404, "body": "{}"}


@pytest.fixture
def sim():
    simulator = Sim()
    try:
        yield simulator
    finally:
        simulator.close()


def oracle_code():
    with open(os.path.join(ROOT, "contracts", "milestone_oracle.py"), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture
def factory(sim):
    return sim.deploy("contracts/milestone_factory.py", [oracle_code()], FUNDER)


def create(sim, factory, builder=BUILDER, funder=FUNDER, checks=CHECKS, window=WINDOW):
    return sim.call(factory, "create_milestone", [builder, TITLE, DEADLINE, json.dumps(checks), window], funder)


def finalize(sim, child, *, met, funder=FUNDER, builder=BUILDER, tag="v1.0.0"):
    """Drive one milestone to FINALIZED. met=True: release exists; False: release missing after the deadline."""
    if met:
        sim.mocks({release_url(tag): release_ok(tag)})
        sim.set_time(T_BEFORE)
    else:
        sim.mocks({release_url(tag): MISSING})
        sim.set_time(T_AFTER)
    sim.call(child, "start_round", [], funder)
    verdict = sim.call(child, "assess", [], builder)
    assert verdict == ("MET" if met else "NOT_MET")
    sim.set_time(T_BEFORE_LATER if met else T_AFTER_LATER)
    assert sim.call(child, "finalize", [], STRANGER) == verdict
    return verdict


# -- the factory -------------------------------------------------------------------------------

def test_factory_info_pins_the_exact_milestone_code(sim, factory):
    info = sim.read_json(factory, "get_factory_info")
    code = oracle_code()
    assert info["code_sha256"] == "0x" + hashlib.sha256(code.encode("utf-8")).hexdigest()
    assert info["code_length"] == len(code)
    assert info["milestones"] == 0 and info["recorded"] == 0
    assert info["deployer"] == FUNDER


@pytest.mark.parametrize("bad", ["", "print('hello')", "class Other: pass"])
def test_factory_refuses_code_that_is_not_a_milestone_oracle(sim, bad):
    with pytest.raises(RpcError):
        sim.deploy("contracts/milestone_factory.py", [bad], FUNDER)


def test_create_milestone_names_the_real_caller_as_funder(sim, factory):
    child = create(sim, factory)
    state = sim.read_json(child, "get_state_json")
    assert state["funder"] == FUNDER and state["builder"] == BUILDER
    assert state["title"] == TITLE and state["phase"] == "IDLE"
    assert sim.read(factory, "is_factory_milestone", [child]) is True
    assert sim.read(factory, "get_milestone_count") == 1
    assert sim.read(factory, "get_milestone_at", [0]) == child


def test_two_callers_get_two_separate_milestones_with_their_own_funder(sim, factory):
    first = create(sim, factory, funder=FUNDER)
    second = create(sim, factory, funder=STRANGER)
    assert first != second
    assert sim.read_json(first, "get_state_json")["funder"] == FUNDER
    assert sim.read_json(second, "get_state_json")["funder"] == STRANGER


def test_builder_must_differ_from_the_caller(sim, factory):
    with pytest.raises(RpcError):
        create(sim, factory, builder=FUNDER, funder=FUNDER)


def test_invalid_checklist_is_refused_and_nothing_is_registered(sim, factory):
    with pytest.raises(RpcError):
        create(sim, factory, checks=[{"id": "x", "kind": "NOPE"}])
    assert sim.read(factory, "get_milestone_count") == 0


def test_pages_list_milestones_with_their_record_state(sim, factory):
    a = create(sim, factory)
    b = create(sim, factory, funder=STRANGER)
    page = sim.read_json(factory, "get_milestones_page", [0, 10])
    assert page["total"] == 2
    assert [row["milestone"] for row in page["items"]] == [a, b]
    assert all(row["recorded"] is False for row in page["items"])
    assert sim.read_json(factory, "get_milestones_page", [1, 1])["items"][0]["milestone"] == b
    for bad in ([-1, 5], [0, 0], [0, 51]):
        with pytest.raises(RpcError):
            sim.read(factory, "get_milestones_page", bad)
    with pytest.raises(RpcError):
        sim.read(factory, "get_milestone_at", [2])


# -- provenance: a look-alike can never enter the record ----------------------------------------

def test_a_directly_deployed_look_alike_is_not_a_factory_milestone(sim, factory):
    fake = sim.deploy("contracts/milestone_oracle.py", [BUILDER, TITLE, DEADLINE, json.dumps(CHECKS), WINDOW], FUNDER)
    assert sim.read(factory, "is_factory_milestone", [fake]) is False
    with pytest.raises(RpcError, match="not a milestone of this factory"):
        sim.call(factory, "record", [fake], STRANGER)
    assert sim.read(factory, "get_record", [fake]) == "NONE"


def test_record_refuses_malformed_and_unknown_addresses(sim, factory):
    for bad in ("0x123", "nope", "0x" + "z" * 40):
        with pytest.raises(RpcError):
            sim.call(factory, "record", [bad], STRANGER)
    with pytest.raises(RpcError, match="not a milestone of this factory"):
        sim.call(factory, "record", ["0x" + "9" * 40], STRANGER)


# -- recording ---------------------------------------------------------------------------------

def test_record_before_finalized_is_refused(sim, factory):
    child = create(sim, factory)
    with pytest.raises(RpcError, match="not FINALIZED"):
        sim.call(factory, "record", [child], STRANGER)
    sim.mocks({release_url("v1.0.0"): release_ok("v1.0.0")})
    sim.set_time(T_BEFORE)
    sim.call(child, "start_round", [], FUNDER)
    assert sim.call(child, "assess", [], BUILDER) == "MET"      # provisional is still not final
    with pytest.raises(RpcError, match="not FINALIZED"):
        sim.call(factory, "record", [child], STRANGER)


def test_met_milestone_is_recorded_by_anyone_and_readable(sim, factory):
    child = create(sim, factory)
    finalize(sim, child, met=True)
    assert sim.call(factory, "record", [child], STRANGER) == "MET"
    rec = sim.read_json(factory, "get_record", [child])
    assert rec["verdict"] == "MET" and rec["milestone"] == child
    assert rec["builder"] == BUILDER and rec["funder"] == FUNDER and rec["title"] == TITLE
    assert rec["deadline_date"] == DEADLINE and rec["round"] == 1 and rec["amendments"] == 0
    assert rec["checks"] == {"release": "PASS"} and rec["check_count"] == 1
    assert rec["history_count"] == 3 and rec["finalized_at"] > 0
    assert sim.read_json(factory, "get_factory_info")["recorded"] == 1
    page = sim.read_json(factory, "get_milestones_page", [0, 5])
    assert page["items"][0]["recorded"] is True


def test_a_milestone_can_only_be_recorded_once(sim, factory):
    child = create(sim, factory)
    finalize(sim, child, met=True)
    sim.call(factory, "record", [child], STRANGER)
    with pytest.raises(RpcError, match="already recorded"):
        sim.call(factory, "record", [child], FUNDER)
    assert sim.read_json(factory, "get_factory_info")["recorded"] == 1


def test_not_met_milestone_is_recorded_as_not_met(sim, factory):
    child = create(sim, factory)
    finalize(sim, child, met=False)
    assert sim.call(factory, "record", [child], STRANGER) == "NOT_MET"
    rec = sim.read_json(factory, "get_record", [child])
    assert rec["verdict"] == "NOT_MET" and rec["checks"] == {"release": "FAIL"}


def test_amendments_are_counted_in_the_record(sim, factory):
    child = create(sim, factory)
    sim.mocks({release_url("v1.0.0"): MISSING, release_url("v1.0.1"): release_ok("v1.0.1")})
    sim.set_time(T_AFTER)
    sim.call(child, "start_round", [], FUNDER)
    assert sim.call(child, "assess", [], BUILDER) == "NOT_MET"
    assert sim.call(child, "amend", ["release", "v1.0.1", "I tagged the release v1.0.1"], BUILDER) == "MET"
    sim.set_time(T_AFTER_LATER)
    assert sim.call(child, "finalize", [], STRANGER) == "MET"
    assert sim.call(factory, "record", [child], STRANGER) == "MET"
    rec = sim.read_json(factory, "get_record", [child])
    assert rec["amendments"] == 1 and rec["history_count"] == 4


# -- the per-builder record --------------------------------------------------------------------

def test_unknown_builder_has_an_empty_record(sim, factory):
    summary = sim.read_json(factory, "get_builder_summary", [BUILDER2])
    assert summary == {"builder": BUILDER2, "created": 0, "recorded": 0, "met": 0, "not_met": 0,
                       "with_amendments": 0, "milestones": []}


def test_builder_summary_counts_only_recorded_milestones(sim, factory):
    done = create(sim, factory)
    waiting = create(sim, factory, funder=STRANGER)
    other_builder = create(sim, factory, builder=BUILDER2)
    finalize(sim, done, met=True)
    sim.call(factory, "record", [done], STRANGER)
    summary = sim.read_json(factory, "get_builder_summary", [BUILDER])
    assert summary["created"] == 2 and summary["recorded"] == 1 and summary["met"] == 1
    assert summary["not_met"] == 0 and summary["with_amendments"] == 0
    assert [row["milestone"] for row in summary["milestones"]] == [done]
    assert sim.read_json(factory, "get_builder_summary", [BUILDER2])["recorded"] == 0
    assert waiting != other_builder


def test_builder_summary_mixes_met_and_not_met(sim, factory):
    good = create(sim, factory)
    finalize(sim, good, met=True)
    sim.call(factory, "record", [good], STRANGER)
    bad = create(sim, factory, funder=STRANGER, checks=CHECKS2)
    finalize(sim, bad, met=False, funder=STRANGER, tag="v2.0.0")
    sim.call(factory, "record", [bad], FUNDER)
    summary = sim.read_json(factory, "get_builder_summary", [BUILDER.upper().replace("0X", "0x")])
    assert summary["recorded"] == 2 and summary["met"] == 1 and summary["not_met"] == 1
    assert {row["verdict"] for row in summary["milestones"]} == {"MET", "NOT_MET"}


# -- ERC-8004-shaped export --------------------------------------------------------------------

def test_export_feedback_is_only_available_for_recorded_milestones(sim, factory):
    child = create(sim, factory)
    with pytest.raises(RpcError, match="not recorded"):
        sim.read(factory, "export_feedback", [child])


def test_export_feedback_shape_and_hash(sim, factory):
    met = create(sim, factory)
    finalize(sim, met, met=True)
    sim.call(factory, "record", [met], STRANGER)
    out = sim.read_json(factory, "export_feedback", [met])
    assert out["subject"] == BUILDER and out["value"] == 100 and out["valueDecimals"] == 0
    assert out["tag1"] == "milestone" and out["tag2"] == "delivery" and out["endpoint"] == met
    raw = sim.read(factory, "get_record", [met])
    assert out["feedbackHash"] == "0x" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert "not written to any registry" in out["shape"]
    bad = create(sim, factory, funder=STRANGER, checks=CHECKS2)
    finalize(sim, bad, met=False, funder=STRANGER, tag="v2.0.0")
    sim.call(factory, "record", [bad], STRANGER)
    assert sim.read_json(factory, "export_feedback", [bad])["value"] == 0


# Adversarial children: demonstrate the boundary, not a claim that custom source is approved.
def supplied_child(tmp_path, changes=None, history_changes=None):
    spec = {"finalized": 1, "phase": "FINALIZED", "final_verdict": "MET", "history_count": 1,
            "final_round": 1, "amendments": 0, "checks": [{"id": "release"}],
            "latest_results": {"release": "PASS"}}
    spec.update(changes or {})
    last = {"action": "FINALIZE", "phase": "FINALIZED", "verdict": "MET", "round": 1,
            "timestamp": 1790000000, "results": {"release": "PASS"}}
    last.update(history_changes or {})
    code = '''# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
class MilestoneOracle(gl.Contract):
    state: str
    def __init__(self, builder, title, deadline, checks, window, funder):
        data = SPEC
        data.setdefault("builder", builder)
        data.setdefault("funder", funder)
        data.setdefault("title", title.strip())
        data["deadline_date"] = deadline
        self.state = json.dumps(data)
    @gl.public.view
    def get_state_json(self) -> str:
        return self.state
    @gl.public.view
    def get_history_json(self, index: int) -> str:
        return json.dumps(LAST)
'''.replace("SPEC", repr(spec)).replace("LAST", repr(last))
    path = tmp_path / "unapproved_child.py"
    path.write_text(code)
    return code


def test_arbitrary_source_hash_does_not_mean_approved_implementation(sim, tmp_path):
    code = supplied_child(tmp_path)
    f = sim.deploy("contracts/milestone_factory.py", [code], FUNDER)
    info = sim.read_json(f, "get_factory_info")
    assert info["code_sha256"] == "0x" + hashlib.sha256(code.encode()).hexdigest()
    assert info["code_sha256"] != "0x" + hashlib.sha256(oracle_code().encode()).hexdigest()
    # A child of this alternate factory fabricates a self-consistent FINALIZED state.
    # Membership + getter consistency are NOT source approval or evidence authentication.
    child = create(sim, f)
    assert sim.call(f, "record", [child], STRANGER) == "MET"
    assert sim.read_json(f, "get_record", [child])["checks"] == {"release": "PASS"}


@pytest.mark.parametrize("changes,last,error", [
    ({"builder": STRANGER}, {}, "does not match"),
    ({"funder": STRANGER}, {}, "does not match"),
    ({"title": "forged title"}, {}, "does not match"),
    ({"finalized": 0}, {}, "not FINALIZED"),
    ({"final_verdict": "INCONCLUSIVE"}, {}, "not MET or NOT_MET"),
    ({"history_count": 0}, {}, "no history"),
    ({}, {"action": "ASSESS"}, "matching FINALIZE"),
    ({}, {"verdict": "NOT_MET"}, "matching FINALIZE"),
])
def test_record_rejects_contradictory_child_metadata(sim, tmp_path, changes, last, error):
    f = sim.deploy("contracts/milestone_factory.py", [supplied_child(tmp_path, changes, last)], FUNDER)
    child = create(sim, f)
    with pytest.raises(RpcError, match=error):
        sim.call(f, "record", [child], STRANGER)
    assert sim.read(f, "get_record", [child]) == "NONE"
    assert sim.read_json(f, "get_factory_info")["recorded"] == 0


def test_identical_creations_are_distinct_and_metadata_is_not_identity(sim, factory):
    first = create(sim, factory)
    second = create(sim, factory)
    assert first != second
    rows = sim.read_json(factory, "get_milestones_page", [0, 50])["items"]
    assert rows[0]["title"] == rows[1]["title"]
    assert rows[0]["funder"] == rows[1]["funder"] == FUNDER
    assert rows[0]["builder"] == rows[1]["builder"] == BUILDER
