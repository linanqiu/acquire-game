"""Application settings from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All settings have sensible defaults for local development.
    In production, set environment variables or use a .env file.
    """

    port: int = 8000
    environment: str = "dev"
    log_level: str = "INFO"
    # Browsers only need CORS for cross-origin use (Vite dev on another port).
    # A single-service deploy is same-origin, so this can stay at the default
    # or be narrowed to your public URL.
    allowed_origins: str = "*"
    # Built React app (env FRONTEND_DIST); relative paths resolve against
    # backend/. Served only if the directory contains index.html.
    frontend_dist: str = "../frontend/dist"
    max_players_per_game: int = 6
    game_timeout_minutes: int = 60
    ws_ping_interval: int = 30
    ws_ping_timeout: int = 10

    # Seat driver (seats.py). Per-decision timeouts by seat kind, in seconds.
    # An LLM decision may need two provider calls (answer + repair) of up to
    # 60 s each, hence the long default.
    bot_decision_timeout: float = 10.0
    scripted_decision_timeout: float = 10.0
    llm_decision_timeout: float = 130.0
    # Pacing of agent moves so humans can follow them (seats.py, BL-020). The
    # pause is a minimum gap between two agent moves, counted from the first
    # one: the time the next agent spends deciding (an LLM's seconds) is part
    # of it, so slow seats get no extra wait.
    # After a move that hands the game to another seat (end of turn, a merger
    # answer, a trade answer) (env AGENT_ACTION_DELAY; 0.4 s per move before
    # BL-020):
    agent_action_delay: float = 0.35
    # Between two moves of the same seat in one turn (place -> found -> buy ->
    # end turn): the board and holdings still change on screen one by one.
    agent_step_delay: float = 0.1
    # Broadcast pace: a game with no human seat that someone is watching
    # (the host/watch page) is played for spectators, so its moves are
    # spaced to be read and for the commentary to keep up. Same two pauses
    # as above (env BROADCAST_ACTION_DELAY, BROADCAST_STEP_DELAY). A room can
    # opt out (`pace: "fast"`, POST /room/{code}/commentary).
    broadcast_action_delay: float = 1.2
    broadcast_step_delay: float = 0.7
    # Both pauses in test mode (GAME_TEST_MODE=1). Small but non-zero so
    # browser tests can still observe an all-bot game in progress; in-process
    # protocol tests set it to 0.
    test_mode_agent_action_delay: float = 0.05
    # Test mode only: seconds the fake LLM seat (``llm:fake``) takes per model
    # call (env FAKE_LLM_DELAY), to see and test waiting on a slow seat.
    fake_llm_delay: float = 0.0
    # Runaway guards, per seat per turn.
    max_agent_actions_per_turn: int = 40
    max_trade_proposals_per_turn: int = 2

    # Table chat (chat.py; docs/architecture/seat-contract.md, "Table chat").
    # Every value can be set by an environment variable of the same name in
    # upper case (e.g. CHAT_REPLY_MAX_PER_GAME=4).
    chat_max_chars: int = 280  # longer messages are refused (422)
    chat_rate_limit_count: int = 5  # messages per player per window ...
    chat_rate_limit_window_s: float = 10.0  # ... else 429
    chat_history_size: int = 200  # kept per room; the last 100 re-sent on connect
    # table chat in an LLM seat's prompts: the whole game (a runaway cap only)
    chat_prompt_messages: int = 300
    # Off-turn talk of LLM seats ("do you want to say something?" calls after
    # chat messages and notable game events; one model call each, at the
    # seat's normal effort; cost counted in the transcript totals).
    chat_replies_enabled: bool = True
    # Which game events give a seat a talk call (comma separated; "" = none).
    # Each one is a paid model call per LLM seat, so only the end of the game
    # by default. Also understood: chain_founded, merger_started,
    # trade_accepted, trade_rejected, majority_lost (see chat.event_targets).
    chat_reply_events: str = "game_ended"
    # A human message that names no seat is offered to at most this many LLM
    # seats (the ones that spoke least so far); a named seat is always asked.
    chat_reply_table_seats: int = 2
    chat_reply_effort: str = "low"  # thinking effort of a talk call ("" = the seat's)
    chat_reply_cooldown_s: float = 4.0  # per seat, between talk calls
    chat_ai_streak_max: int = 2  # AI messages in a row before AI talk stops
    #                              triggering more (a human message or a move resets)
    chat_reply_max_per_game: int = 40  # runaway guard per seat per game (and lobby)
    chat_reply_max_tokens: int = (
        2048  # output cap (thinking included); replies are short
    )
    chat_reply_timeout_s: float = 30.0

    # Commentary for spectators (commentary.py; docs/ai/commentary.md). A
    # non-playing voice on the host/watch page. It only runs while commentary
    # is on for the room AND a spectator is connected.
    # Which model writes the lines (env GAME_COMMENTARY_MODEL): a catalog id
    # ("llm:claude-haiku-5-5") or model name; "rules" / "off" = templated
    # lines only, no model call. Empty: the catalog's Haiku entry when it has
    # a key, else rules-only.
    game_commentary_model: str = ""
    commentary_min_gap_s: float = 8.0  # at most one line per this many seconds
    test_mode_commentary_min_gap_s: float = 0.4  # the gap in test mode
    commentary_quiet_turns: int = 8  # turns without a line -> "state of the table"
    commentary_max_lines_per_game: int = 80  # lines of any kind (the result is extra)
    commentary_max_calls_per_game: int = 60  # model calls; then rules-only
    commentary_max_spend_usd: float = 0.05  # model spend per game; then rules-only
    commentary_max_tokens: int = 2048  # output cap of a call (thinking included)
    commentary_effort: str = "low"  # thinking effort of a call ("" = the model's)
    commentary_timeout_s: float = 12.0
    commentary_memory_lines: int = 6  # its own latest lines shown to the model
    commentary_history_size: int = 200  # lines kept per room (100 re-sent on connect)
    # "Watch bots play" (POST /create-show): the seats of the game it starts,
    # comma-separated catalog ids (env SHOW_SEATS). Rules-based bots cost
    # nothing; an LLM seat ("llm:claude-haiku-5-5") is paid for on every show.
    show_seats: str = "bot,bot,bot,bot"

    # Game variant / theme (env GAME_RULESET): a name in backend/rulesets/
    # ("default", "valley", "mini") or a path to a ruleset JSON file. New
    # games use it; see game/ruleset.py and docs/architecture/seat-contract.md.
    game_ruleset: str = "default"
    # Product name (env GAME_BRAND_NAME): site title, browser tab, headers and
    # bench pages. Separate from a ruleset's theme title ("Grand Hotels").
    game_brand_name: str = "Buyout"

    @property
    def cors_origins(self) -> list[str]:
        """Parse comma-separated origins into a list."""
        if self.allowed_origins == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",")]

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "prod"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    """Get cached application settings."""
    return Settings()


def get_ruleset():
    """The server's configured ruleset (``Settings.game_ruleset``).

    Read per call (files are cached by name), so a test may change the
    setting at runtime. Raises ``RulesetError`` for a bad name or file.
    """
    from game.ruleset import load_ruleset

    return load_ruleset(get_settings().game_ruleset)
