"""The bank's stock and the chain registry (game/hotel.py).

Prices and bonuses themselves are checked against the frozen classic table in
test_ruleset.py and through play in tests/gameplay; this file covers the bank
bookkeeping that play relies on and the classic aliases older callers use.
"""

from game.hotel import Hotel, HotelChain, HotelTier
from game.ruleset import classic, load_ruleset


def test_bank_never_sells_more_than_it_has_and_never_holds_more_than_issued():
    hotel = Hotel()
    assert hotel.buy_stock("Luxor", 24) is True
    assert hotel.buy_stock("Luxor", 2) is False  # only 1 left: nothing sold
    assert hotel.get_available_stocks("Luxor") == 1
    assert hotel.buy_stock("Luxor", 1) is True
    assert hotel.get_available_stocks("Luxor") == 0
    hotel.return_stock("Luxor", 3)
    assert hotel.get_available_stocks("Luxor") == 3
    hotel.return_stock("Luxor")  # one share by default
    assert hotel.get_available_stocks("Luxor") == 4
    assert hotel.buy_stock("Luxor") is True  # one share by default
    assert hotel.get_available_stocks("Luxor") == 3
    hotel.return_stock("Luxor", 30)
    assert hotel.get_available_stocks("Luxor") == 25


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
    assert hotel.get_state() == {
        "available_stocks": {c: 18 for c in ids},
        "active_chains": [ids[2]],
    }


def test_classic_aliases_agree_with_the_ruleset():
    rs = classic()
    luxor = Hotel.get_chain("Luxor")
    assert luxor == HotelChain("Luxor", HotelTier.CHEAP, luxor.color)
    for size in (2, 6, 11, 41):
        assert luxor.get_stock_price(size) == rs.price("Luxor", size)
        assert luxor.get_majority_bonus(size) == rs.majority_bonus("Luxor", size)
        assert luxor.get_minority_bonus(size) == rs.minority_bonus("Luxor", size)
    assert (luxor.is_safe(10), luxor.is_safe(11)) == (False, True)
    assert Hotel().is_chain_safe("Luxor", 11) is True
    assert Hotel().get_chain("Imperial").tier_id == "expensive"
