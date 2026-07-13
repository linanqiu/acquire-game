"""Tests for SH-004: player name sanitization."""

import pytest

from main import sanitize_player_name


class TestSanitizePlayerName:
    """Unit tests for the sanitize_player_name helper."""

    def test_valid_simple_name(self):
        assert sanitize_player_name("Alice") == "Alice"

    def test_valid_name_with_allowed_punctuation(self):
        assert sanitize_player_name("Dr. Bob-Smith_99") == "Dr. Bob-Smith_99"

    def test_trims_whitespace(self):
        assert sanitize_player_name("  Alice  ") == "Alice"

    def test_collapses_internal_whitespace(self):
        assert sanitize_player_name("Alice   B\t Smith") == "Alice B Smith"

    def test_empty_name_rejected(self):
        with pytest.raises(ValueError, match="at least 2"):
            sanitize_player_name("")

    def test_whitespace_only_name_rejected(self):
        with pytest.raises(ValueError, match="at least 2"):
            sanitize_player_name("    ")

    def test_single_character_rejected(self):
        with pytest.raises(ValueError, match="at least 2"):
            sanitize_player_name("A")

    def test_two_characters_accepted(self):
        assert sanitize_player_name("Al") == "Al"

    def test_twenty_characters_accepted(self):
        name = "A" * 20
        assert sanitize_player_name(name) == name

    def test_twenty_one_characters_rejected(self):
        with pytest.raises(ValueError, match="at most 20"):
            sanitize_player_name("A" * 21)

    def test_html_tags_rejected(self):
        with pytest.raises(ValueError, match="invalid characters"):
            sanitize_player_name("<script>ha</b>")

    def test_html_entities_rejected(self):
        with pytest.raises(ValueError, match="invalid characters"):
            sanitize_player_name("a&amp;b")

    def test_quotes_rejected(self):
        with pytest.raises(ValueError, match="invalid characters"):
            sanitize_player_name('Bob"the"Great')

    def test_non_ascii_homoglyphs_rejected(self):
        # Cyrillic 'А' looks like Latin 'A' - reject to prevent impersonation
        with pytest.raises(ValueError, match="invalid characters"):
            sanitize_player_name("Аlice")

    def test_emoji_rejected(self):
        with pytest.raises(ValueError, match="invalid characters"):
            sanitize_player_name("Bob\U0001f600")


class TestCreateEndpointValidation:
    """Name sanitization applied to /create."""

    def test_valid_name_succeeds(self, client, clean_session_manager):
        response = client.post("/create", data={"player_name": "ValidName123"})
        assert response.status_code == 200

    def test_script_tag_rejected(self, client, clean_session_manager):
        response = client.post("/create", data={"player_name": "<script>hi"})
        assert response.status_code == 400
        assert "invalid characters" in response.json()["detail"].lower()

    def test_full_script_payload_rejected(self, client, clean_session_manager):
        """Longer XSS payloads are rejected too (by length before charset)."""
        response = client.post(
            "/create", data={"player_name": "<script>alert(1)</script>"}
        )
        assert response.status_code == 400

    def test_whitespace_only_rejected(self, client, clean_session_manager):
        response = client.post("/create", data={"player_name": "   "})
        assert response.status_code == 400

    def test_too_long_rejected(self, client, clean_session_manager):
        response = client.post("/create", data={"player_name": "A" * 30})
        assert response.status_code == 400

    def test_name_normalized_before_storing(self, client, clean_session_manager):
        response = client.post("/create", data={"player_name": "  Alice   Smith "})
        assert response.status_code == 200
        data = response.json()
        room = clean_session_manager.get_room(data["room_code"])
        assert room.players[data["player_id"]].name == "Alice Smith"


class TestJoinEndpointValidation:
    """Name sanitization applied to /join."""

    def _create_room(self, client):
        return client.post("/create", data={"player_name": "Alice"}).json()["room_code"]

    def test_valid_name_succeeds(self, client, clean_session_manager):
        room_code = self._create_room(client)
        response = client.post(
            "/join", data={"room_code": room_code, "player_name": "Bob"}
        )
        assert response.status_code == 200

    def test_invalid_name_rejected(self, client, clean_session_manager):
        room_code = self._create_room(client)
        response = client.post(
            "/join",
            data={"room_code": room_code, "player_name": "<img onerror=x>"},
        )
        assert response.status_code == 400
        assert "invalid characters" in response.json()["detail"].lower()

    def test_single_char_name_rejected(self, client, clean_session_manager):
        room_code = self._create_room(client)
        response = client.post(
            "/join", data={"room_code": room_code, "player_name": "B"}
        )
        assert response.status_code == 400

    def test_duplicate_after_normalization_rejected(
        self, client, clean_session_manager
    ):
        """Normalized names still collide with existing names."""
        room_code = self._create_room(client)
        response = client.post(
            "/join", data={"room_code": room_code, "player_name": "  alice "}
        )
        assert response.status_code == 400
        assert "taken" in response.json()["detail"].lower()
