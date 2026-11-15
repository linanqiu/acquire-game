"""The bank's stock and the chain registry (game/hotel.py).

Prices and bonuses themselves are checked against the frozen default table in
test_ruleset.py and through play in tests/gameplay; this file covers the bank
bookkeeping that play relies on.
"""

from game.hotel import Hotel
from game.ruleset import load_ruleset


def test_bank_never_sells_more_than_it_has_and_never_holds_more_than_issued():
    hotel = Hotel()
    assert hotel.buy_stock("sandpiper", 24) is True
    assert hotel.buy_stock("sandpiper", 2) is False  # only 1 left: nothing sold
    assert hotel.get_available_stocks("sandpiper") == 1
    assert hotel.buy_stock("sandpiper", 1) is True
    assert hotel.get_available_stocks("sandpiper") == 0
    hotel.return_stock("sandpiper", 3)
    assert hotel.get_available_stocks("sandpiper") == 3
    hotel.return_stock("sandpiper")  # one share by default
    assert hotel.get_available_stocks("sandpiper") == 4
    assert hotel.buy_stock("sandpiper") is True  # one share by default
    assert hotel.get_available_stocks("sandpiper") == 3
    hotel.return_stock("sandpiper", 30)
    assert hotel.get_available_stocks("sandpiper") == 25


def test_active_and_inactive_chains():
    hotel = Hotel(load_ruleset("mini"))
    ids = hotel.get_all_chain_names()
    assert ids == load_ruleset("mini").chain_ids
    hotel.activate_chain(ids[2])
    hotel.activate_chain(ids[0])
    assert hotel.get_active_chains() == sorted([ids[0], ids[2]])
    assert hotel.get_inactive_chains() == [c for c in ids if c not in (ids[0], ids[2])]
    hotel.deactivate_chain(ids[0])
    assert hotel.get_active_chains() == [ids[2]]
    assert {c: hotel.get_available_stocks(c) for c in ids} == {c: 18 for c in ids}
