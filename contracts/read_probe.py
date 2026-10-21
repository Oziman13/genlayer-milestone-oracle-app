# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from genlayer.py.public_abi import StorageType

# Diagnostic only. Reads another contract's state in different ways so we can see which way
# works on the live network. Holds nothing and changes nothing except `last`.

_MODES = {"default": StorageType.DEFAULT, "final": StorageType.LATEST_FINAL, "nonfinal": StorageType.LATEST_NON_FINAL}


def _read(address: str, mode: str) -> str:
    if mode not in _MODES:
        raise gl.vm.UserError("unknown mode")
    proxy = gl.get_contract_at(Address(address))
    return proxy.view(state=_MODES[mode]).get_state_json()


class ReadProbe(gl.Contract):
    last: str

    def __init__(self):
        self.last = ""

    @gl.public.view
    def read_view(self, address: str, mode: str) -> str:
        return _read(address, mode)[:300]

    @gl.public.write
    def read_write(self, address: str, mode: str) -> str:
        self.last = _read(address, mode)[:300]
        return self.last

    @gl.public.view
    def get_last(self) -> str:
        return self.last
