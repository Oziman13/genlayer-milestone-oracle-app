"""v0.2.0: explicit funder argument (used by MilestoneFactory so the real caller is the funder)."""

import json

import pytest

from test_milestone_oracle import (CHECKS, CONTRACT, DEADLINE, T0, TITLE, WINDOW, hexaddr, set_time, state)


def deploy_with_funder(vm, deploy_fn, sender, builder, funder):
    vm.sender = sender
    set_time(vm, T0)
    return deploy_fn(CONTRACT, hexaddr(builder), TITLE, DEADLINE, json.dumps(CHECKS), WINDOW, funder)


def test_explicit_funder_is_stored_instead_of_the_deployer(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    c = deploy_with_funder(direct_vm, direct_deploy, direct_owner, direct_alice, hexaddr(direct_bob))
    s = state(c)
    assert s["funder"] == hexaddr(direct_bob) and s["builder"] == hexaddr(direct_alice)


def test_explicit_funder_gets_funder_rights_and_deployer_does_not(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    c = deploy_with_funder(direct_vm, direct_deploy, direct_owner, direct_alice, hexaddr(direct_bob))
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("funder or builder only"):
        c.start_round()
    direct_vm.sender = direct_bob
    set_time(direct_vm, T0)
    c.start_round()
    assert state(c)["phase"] == "OPEN"


def test_builder_must_differ_from_explicit_funder(direct_vm, direct_deploy, direct_owner, direct_alice):
    with direct_vm.expect_revert("builder must differ from funder"):
        deploy_with_funder(direct_vm, direct_deploy, direct_owner, direct_alice, hexaddr(direct_alice))


@pytest.mark.parametrize("bad", ["0x123", "alice", "0x" + "g" * 40])
def test_bad_funder_address(direct_vm, direct_deploy, direct_owner, direct_alice, bad):
    with direct_vm.expect_revert("invalid address"):
        deploy_with_funder(direct_vm, direct_deploy, direct_owner, direct_alice, bad)
