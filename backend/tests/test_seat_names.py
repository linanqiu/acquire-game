"""Default AI seat names (session.seat_names, BL-010)."""

from __future__ import annotations

import random
import re

from session.manager import SessionManager
from session.seat_names import (
    FALLBACK_BASE,
    SEAT_NAMES,
    first_word,
    name_rng,
    pick_seat_name,
    short_names,
)

MODEL_WORDS = re.compile(r"claude|haiku|sonnet|opus|kimi|llm|gpt|model|bot\b", re.I)


class TestTheList:
    def test_at_least_forty_short_names(self):
        assert len(SEAT_NAMES) >= 40
        for n in SEAT_NAMES:
            assert 1 <= len(n.split()) <= 2, n
            assert len(n) <= 14, n
            assert n == n.strip() and "  " not in n, n

    def test_names_and_first_words_are_unique(self):
        assert len({n.lower() for n in SEAT_NAMES}) == len(SEAT_NAMES)
        firsts = [first_word(n) for n in SEAT_NAMES]
        assert len(set(firsts)) == len(firsts)

    def test_no_model_or_kind_words(self):
        for n in SEAT_NAMES:
            assert not MODEL_WORDS.search(n), n


class TestPick:
    def test_unique_case_insensitive_and_against_humans(self):
        taken = [n.upper() for n in SEAT_NAMES[:-1]]  # humans typed them shouting
        assert pick_seat_name(taken, random.Random(1)) == SEAT_NAMES[-1]

    def test_first_word_clash_is_skipped(self):
        # A human called "Baron" (or "Baron Bob") blocks "Baron Brick": the chat
        # would otherwise not know who "Baron" means.
        names = ("Baron Brick", "Lady Ledger")
        for human in ("Baron", "baron bob"):
            for seed in range(20):
                assert pick_seat_name([human], random.Random(seed), names) == (
                    "Lady Ledger"
                )

    def test_list_exhaustion_falls_back_to_numbers(self):
        names = ("Baron Brick", "Lady Ledger")
        rng = random.Random(0)
        taken = ["Alice"]
        for _ in range(2):
            taken.append(pick_seat_name(taken, rng, names))
        assert sorted(taken[1:]) == ["Baron Brick", "Lady Ledger"]
        taken.append(pick_seat_name(taken, rng, names))
        assert taken[-1] == f"{FALLBACK_BASE} 1"
        taken.append(pick_seat_name(taken + ["tycoon 2"], rng, names))
        assert taken[-1] == f"{FALLBACK_BASE} 3"

    def test_random_per_room_but_deterministic_under_a_seed(self, monkeypatch):
        monkeypatch.delenv("GAME_SEED", raising=False)
        a = [pick_seat_name([], name_rng(7)) for _ in range(1)]
        b = [pick_seat_name([], name_rng(7)) for _ in range(1)]
        assert a == b
        monkeypatch.setenv("GAME_SEED", "2")
        seq1 = [pick_seat_name([], name_rng(None)) for _ in range(3)]
        seq2 = [pick_seat_name([], name_rng(None)) for _ in range(3)]
        assert seq1 == seq2
        # Unseeded rooms differ: 30 draws from 48 names are not all the same.
        monkeypatch.delenv("GAME_SEED")
        assert len({pick_seat_name([], name_rng(None)) for _ in range(30)}) > 1


class TestShortNames:
    def test_distinctive_first_words(self):
        names = {"a": "Alice", "b": "Baron Brick", "c": "Lady Ledger", "d": "Lady Jo"}
        assert short_names(names) == {"b": "baron"}

    def test_every_list_name_has_a_short_name(self):
        names = {str(i): n for i, n in enumerate(SEAT_NAMES)}
        short = short_names(names)
        # 2-letter titles ("Mr") are too short to address anyone by.
        assert len(short) >= len(SEAT_NAMES) - 1


class TestSessionManager:
    def test_room_names_follow_the_room_seed(self, monkeypatch):
        monkeypatch.delenv("GAME_SEED", raising=False)

        def names(seed):
            m = SessionManager()
            code = m.create_room()
            m.get_room(code).seed = seed
            m.join_room(code, "h", "Alice")
            return [m.get_room(code).players[m.add_bot(code)].name for _ in range(5)]

        first = names(42)
        assert first == names(42)
        assert len(set(first)) == 5 and set(first) <= set(SEAT_NAMES)
