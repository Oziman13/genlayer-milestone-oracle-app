"""Compatibility/guarantee tests: current evidence is intentionally not historical proof."""
import json
import pytest
from test_milestone_oracle import (
    CHECKS, ALL4, T0, T_AFTER, LIVE, RAW, PHRASE, CLAIM, API, TAG,
    opened, set_time, web, llm, all_good, state, history,
)


@pytest.mark.parametrize("kind", ["REPO_FILE", "LIVE_PAGE", "DELIVERABLE"])
@pytest.mark.parametrize("at", [T0, T_AFTER])
def test_current_state_passes_without_publication_timestamp(direct_vm, direct_deploy, direct_owner, direct_alice, kind, at):
    check = next(c for c in ALL4 if c["kind"] == kind)
    c = opened(direct_vm, direct_deploy, direct_owner, direct_alice, checks=[check])
    set_time(direct_vm, at)
    if kind == "DELIVERABLE":
        quote = "A working form displays the submitted result immediately."
        web(direct_vm, LIVE, 200, quote)
        llm(direct_vm, LIVE, True, quote)
    else:
        url = RAW + "README.md" if kind == "REPO_FILE" else LIVE
        web(direct_vm, url, 200, check["phrase"])
    assert c.assess() == "MET"
    assert c.get_attestation() == "NONE"


def test_content_first_appearing_after_deadline_can_pass(direct_vm, direct_deploy, direct_owner, direct_alice):
    check = CHECKS[1]
    c = opened(direct_vm, direct_deploy, direct_owner, direct_alice, checks=[check])
    web(direct_vm, RAW + "README.md", 200, "No required text yet")
    assert c.assess() == "NOT_YET"
    direct_vm.clear_mocks()
    set_time(direct_vm, T_AFTER)
    web(direct_vm, RAW + "README.md", 200, PHRASE)
    c.start_round()
    assert c.assess() == "MET"  # current-state guarantee only
    set_time(direct_vm, "2026-12-05T12:10:00Z")
    assert c.finalize() == "MET"
    assert c.get_attestation() == "MET"
    assert history(c)[1]["results"] == {check["id"]: "FAIL"}


def test_changed_bytes_with_same_phrase_still_finalize(direct_vm, direct_deploy, direct_owner, direct_alice):
    c = opened(direct_vm, direct_deploy, direct_owner, direct_alice, checks=[CHECKS[1]])
    web(direct_vm, RAW + "README.md", 200, "Old content " + PHRASE)
    assert c.assess() == "MET"
    direct_vm.clear_mocks()
    web(direct_vm, RAW + "README.md", 200, "Entirely revised content " + PHRASE)
    set_time(direct_vm, "2026-12-05T12:10:00Z")
    assert c.finalize() == "MET"  # no byte identity commitment
    assert c.get_attestation() == "MET"


def test_different_failed_checks_with_same_not_met_verdict_can_finalize(direct_vm, direct_deploy, direct_owner, direct_alice):
    c = opened(direct_vm, direct_deploy, direct_owner, direct_alice, checks=CHECKS[1:])
    set_time(direct_vm, T_AFTER)
    web(direct_vm, RAW + "README.md", 404, "")
    web(direct_vm, LIVE, 200, "Toolkit demo is running")
    assert c.assess() == "NOT_MET"
    direct_vm.clear_mocks()
    web(direct_vm, RAW + "README.md", 200, PHRASE)
    web(direct_vm, LIVE, 404, "")
    set_time(direct_vm, "2026-12-05T12:10:00Z")
    assert c.finalize() == "NOT_MET"  # compares verdict, not per-check map
    assert history(c)[1]["results"] != history(c)[2]["results"]
    assert state(c)["finalized"] == 1
