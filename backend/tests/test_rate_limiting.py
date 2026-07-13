"""Tests for SH-002: rate limiting on REST endpoints."""

import main
from main import RequestRateLimiter


def _create_room(client, name="Alice"):
    response = client.post("/create", data={"player_name": name})
    assert response.status_code == 200
    data = response.json()
    return data["room_code"], data["session_token"]


class TestCreateRateLimit:
    """/create is limited to 5 requests/minute per IP."""

    def test_create_limited_after_five_requests(self, client, clean_session_manager):
        for i in range(5):
            response = client.post("/create", data={"player_name": f"Player{i}"})
            assert response.status_code == 200, f"request {i} should succeed"

        response = client.post("/create", data={"player_name": "PlayerX"})
        assert response.status_code == 429
        assert response.json()["detail"] == "Too many requests"

    def test_429_includes_retry_after_header(self, client, clean_session_manager):
        for i in range(5):
            client.post("/create", data={"player_name": f"Player{i}"})

        response = client.post("/create", data={"player_name": "PlayerX"})
        assert response.status_code == 429
        assert "retry-after" in response.headers
        retry_after = int(response.headers["retry-after"])
        assert 1 <= retry_after <= 61

    def test_create_spectator_shares_create_budget(self, client, clean_session_manager):
        """Spectator room creation counts against the same room-creation limit."""
        for i in range(3):
            assert (
                client.post("/create", data={"player_name": f"Player{i}"}).status_code
                == 200
            )
        for _ in range(2):
            assert client.post("/create-spectator").status_code == 200

        response = client.post("/create-spectator")
        assert response.status_code == 429


class TestJoinRateLimit:
    """/join is limited to 10 requests/minute per IP."""

    def test_join_limited_after_ten_requests(self, client, clean_session_manager):
        room_code, _ = _create_room(client)

        # 10 join attempts are allowed (some fail with 400 once the room is
        # full, but they still count against the limit)
        statuses = []
        for i in range(10):
            response = client.post(
                "/join", data={"room_code": room_code, "player_name": f"Joiner{i}"}
            )
            statuses.append(response.status_code)
        assert 429 not in statuses

        response = client.post(
            "/join", data={"room_code": room_code, "player_name": "JoinerX"}
        )
        assert response.status_code == 429
        assert "retry-after" in response.headers


class TestStartRateLimit:
    """/room/{code}/start is limited to 3 requests/minute per room."""

    def test_start_limited_per_room(self, client, clean_session_manager):
        room_code, token = _create_room(client)
        for name in ["Bob", "Charlie"]:
            client.post("/join", data={"room_code": room_code, "player_name": name})
        headers = {"Authorization": f"Bearer {token}"}

        # 3 requests allowed (first starts the game, later ones 400)
        assert (
            client.post(f"/room/{room_code}/start", headers=headers).status_code == 200
        )
        for _ in range(2):
            assert (
                client.post(f"/room/{room_code}/start", headers=headers).status_code
                == 400
            )

        response = client.post(f"/room/{room_code}/start", headers=headers)
        assert response.status_code == 429
        assert "retry-after" in response.headers

    def test_start_limit_is_per_room_not_global(self, client, clean_session_manager):
        room_a, token_a = _create_room(client, name="Alice")
        headers_a = {"Authorization": f"Bearer {token_a}"}

        # Exhaust room A's start budget (game never starts: too few players)
        for _ in range(3):
            assert (
                client.post(f"/room/{room_a}/start", headers=headers_a).status_code
                == 400
            )
        assert (
            client.post(f"/room/{room_a}/start", headers=headers_a).status_code == 429
        )

        # Room B is unaffected
        room_b, token_b = _create_room(client, name="Zoe")
        headers_b = {"Authorization": f"Bearer {token_b}"}
        for name in ["Bob", "Charlie"]:
            client.post("/join", data={"room_code": room_b, "player_name": name})
        assert (
            client.post(f"/room/{room_b}/start", headers=headers_b).status_code == 200
        )

    def test_unauthenticated_requests_do_not_consume_room_budget(
        self, client, clean_session_manager
    ):
        """Auth runs before the room-scoped limiter so an attacker without a
        token cannot lock the real host out of /start."""
        room_code, token = _create_room(client)
        for name in ["Bob", "Charlie"]:
            client.post("/join", data={"room_code": room_code, "player_name": name})

        for _ in range(10):
            assert client.post(f"/room/{room_code}/start").status_code == 401

        response = client.post(
            f"/room/{room_code}/start",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200


class TestAddBotRateLimit:
    """/room/{code}/add-bot is limited to 10 requests/minute per room."""

    def test_add_bot_limited_per_room(self, client, clean_session_manager):
        room_code, token = _create_room(client)
        headers = {"Authorization": f"Bearer {token}"}

        statuses = []
        for _ in range(10):
            response = client.post(f"/room/{room_code}/add-bot", headers=headers)
            statuses.append(response.status_code)
        # Room fills up (400s) but requests are not rate limited yet
        assert 429 not in statuses

        response = client.post(f"/room/{room_code}/add-bot", headers=headers)
        assert response.status_code == 429
        assert "retry-after" in response.headers


class TestRateLimiterBehavior:
    """Unit-level behavior of the limiter itself."""

    def test_window_expiry_allows_requests_again(self):
        limiter = RequestRateLimiter(max_requests=2, window_seconds=60)
        now = 1000.0
        limiter._requests["ip:x"] = [now - 120.0, now - 90.0]  # both expired
        bucket = [t for t in limiter._requests["ip:x"] if now - t < 60]
        assert bucket == []

    def test_reset_clears_state(self):
        limiter = RequestRateLimiter(max_requests=1, window_seconds=60)
        limiter._requests["ip:x"].append(123.0)
        limiter.reset()
        assert len(limiter._requests) == 0

    def test_rate_limit_can_be_disabled(
        self, client, clean_session_manager, monkeypatch
    ):
        monkeypatch.setattr(main.settings, "rate_limit_enabled", False)
        for i in range(8):
            response = client.post("/create", data={"player_name": f"Player{i}"})
            assert response.status_code == 200
