"""Game phases and the names clients see for them."""

from enum import Enum


class GamePhase(Enum):
    """Game phases that control what actions are valid."""

    LOBBY = "lobby"
    PLAYING = "playing"
    FOUNDING_CHAIN = "founding_chain"
    MERGING = "merging"
    BUYING_STOCKS = "buying_stocks"
    GAME_OVER = "game_over"


# Phase names as clients see them (public state ``phase``)
PHASE_NAMES = {
    GamePhase.LOBBY: "lobby",
    GamePhase.PLAYING: "place_tile",
    GamePhase.FOUNDING_CHAIN: "found_chain",
    GamePhase.MERGING: "merger",
    GamePhase.BUYING_STOCKS: "buy_stocks",
    GamePhase.GAME_OVER: "game_over",
}
