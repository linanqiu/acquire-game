"""Integration tests for lobby create/join game flows."""


class TestCreateGameFlow:
    """Tests for the create game flow."""

    def test_create_redirects_to_player(self, client, clean_session_manager):
        """POST /create should redirect to player view with is_host flag."""
        response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        assert response.status_code == 303
        assert "/play/" in response.headers["location"]
        assert "is_host=1" in response.headers["location"]

    def test_create_includes_credentials_in_redirect(
        self, client, clean_session_manager
    ):
        """Redirect URL should include player_id and session_token."""
        response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = response.headers["location"]
        assert "player_id=" in location
        assert "session_token=" in location

    def test_creator_added_to_room(self, client, clean_session_manager):
        """Creator should be added to the room as first player."""
        response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )

        # Extract room code from redirect URL
        location = response.headers["location"]
        # URL format: /play/XXXX?player_id=...&session_token=...&is_host=1
        room_code = location.split("/play/")[1].split("?")[0]

        room = clean_session_manager.get_room(room_code)
        assert room is not None
        assert len(room.players) == 1

        # Verify player name
        player = list(room.players.values())[0]
        assert player.name == "Alice"

    def test_create_with_follow_redirects(self, client, clean_session_manager):
        """Following redirects should render host page."""
        response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=True,
        )
        assert response.status_code == 200
        # Should contain room code display
        assert (
            b"room_code" in response.content.lower() or b"Room Code" in response.content
        )

    def test_create_requires_player_name(self, client, clean_session_manager):
        """POST /create without player_name should fail."""
        response = client.post("/create", data={})
        assert response.status_code == 422  # Validation error


class TestJoinGameFlow:
    """Tests for the join game flow."""

    def test_join_redirects_to_player(self, client, room_code):
        """POST /join/{room_code} should redirect to player view."""
        response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        assert response.status_code == 303
        assert f"/play/{room_code}" in response.headers["location"]

    def test_join_includes_credentials_in_redirect(self, client, room_code):
        """Redirect URL should include player_id and session_token."""
        response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        location = response.headers["location"]
        assert "player_id=" in location
        assert "session_token=" in location

    def test_join_adds_player_to_room(self, client, room_code, clean_session_manager):
        """Joining should add player to room."""
        client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )

        room = clean_session_manager.get_room(room_code)
        assert len(room.players) == 1

        player = list(room.players.values())[0]
        assert player.name == "Bob"

    def test_join_case_insensitive_room_code(
        self, client, room_code, clean_session_manager
    ):
        """Room code should be case insensitive."""
        lower_code = room_code.lower()
        response = client.post(
            f"/join/{lower_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        assert response.status_code == 303
        assert room_code.upper() in response.headers["location"]

    def test_join_nonexistent_room(self, client, clean_session_manager):
        """Joining nonexistent room should return 404."""
        response = client.post(
            "/join/XXXX",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        assert response.status_code == 404

    def test_join_requires_player_name(self, client, room_code):
        """POST /join without player_name should fail."""
        response = client.post(f"/join/{room_code}", data={})
        assert response.status_code == 422

    def test_join_with_follow_redirects(self, client, room_code):
        """Following redirects should render player page."""
        response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=True,
        )
        assert response.status_code == 200


class TestFullCycle:
    """Tests for the full create-join-start game cycle."""

    def test_create_then_join(self, client, clean_session_manager):
        """Create a room, then join with another player."""
        # Create room
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Join room
        join_response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        assert join_response.status_code == 303

        # Verify both players in room
        room = clean_session_manager.get_room(room_code)
        assert len(room.players) == 2

        names = [p.name for p in room.players.values()]
        assert "Alice" in names
        assert "Bob" in names

    def test_full_game_start_cycle(self, client, clean_session_manager):
        """Create room, join second player, start game."""
        # Create room
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Join second player
        client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )

        # Start game
        start_response = client.post(f"/room/{room_code}/start")
        assert start_response.status_code == 200
        assert start_response.json()["status"] == "started"

        # Verify game started
        room = clean_session_manager.get_room(room_code)
        assert room.started is True

    def test_cannot_join_started_game(self, client, clean_session_manager):
        """Cannot join a game that has already started."""
        # Create and setup room
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Join second player
        client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )

        # Start game
        client.post(f"/room/{room_code}/start")

        # Try to join after game started
        late_join = client.post(
            f"/join/{room_code}",
            data={"player_name": "Charlie"},
            follow_redirects=False,
        )
        assert late_join.status_code == 400
        assert "started" in late_join.json()["detail"].lower()

    def test_cannot_join_full_room(self, client, clean_session_manager):
        """Cannot join a room that is full (6 players)."""
        # Create room
        create_response = client.post(
            "/create",
            data={"player_name": "Player0"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Join 5 more players (total 6)
        for i in range(1, 6):
            client.post(
                f"/join/{room_code}",
                data={"player_name": f"Player{i}"},
                follow_redirects=False,
            )

        # Verify room is full
        room = clean_session_manager.get_room(room_code)
        assert len(room.players) == 6

        # 7th player should fail
        late_join = client.post(
            f"/join/{room_code}",
            data={"player_name": "Player6"},
            follow_redirects=False,
        )
        assert late_join.status_code == 400
        assert "full" in late_join.json()["detail"].lower()


class TestDuplicateNames:
    """Tests for duplicate name rejection."""

    def test_cannot_join_with_duplicate_name(self, client, clean_session_manager):
        """Cannot join a room with an existing player name."""
        # Create room with first player
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Try to join with same name
        join_response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        assert join_response.status_code == 400
        assert "already taken" in join_response.json()["detail"].lower()

    def test_name_check_is_case_insensitive(self, client, clean_session_manager):
        """Name check should be case insensitive."""
        # Create room with first player
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Try to join with same name but different case
        join_response = client.post(
            f"/join/{room_code}",
            data={"player_name": "ALICE"},
            follow_redirects=False,
        )
        assert join_response.status_code == 400
        assert "already taken" in join_response.json()["detail"].lower()

        # Try another case variation
        join_response2 = client.post(
            f"/join/{room_code}",
            data={"player_name": "alice"},
            follow_redirects=False,
        )
        assert join_response2.status_code == 400
        assert "already taken" in join_response2.json()["detail"].lower()

    def test_different_names_can_join(self, client, clean_session_manager):
        """Different names should be allowed."""
        # Create room with first player
        create_response = client.post(
            "/create",
            data={"player_name": "Alice"},
            follow_redirects=False,
        )
        location = create_response.headers["location"]
        room_code = location.split("/play/")[1].split("?")[0]

        # Join with a different name
        join_response = client.post(
            f"/join/{room_code}",
            data={"player_name": "Bob"},
            follow_redirects=False,
        )
        assert join_response.status_code == 303

        # Verify both players in room
        room = clean_session_manager.get_room(room_code)
        names = [p.name for p in room.players.values()]
        assert "Alice" in names
        assert "Bob" in names


class TestViewEndpoints:
    """Tests for host and player view endpoints with credentials."""

    def test_host_view_accepts_credentials(self, client, room_code):
        """Host view should accept player_id and session_token params."""
        response = client.get(f"/host/{room_code}?player_id=test123&session_token=abc")
        assert response.status_code == 200

    def test_player_view_accepts_credentials(
        self, client, room_code, clean_session_manager
    ):
        """Player view should accept session_token param."""
        # First add a player to the room
        player_id = "test_player_123"
        clean_session_manager.join_room(room_code, player_id, "TestPlayer")

        response = client.get(
            f"/play/{room_code}?player_id={player_id}&session_token=abc"
        )
        assert response.status_code == 200

    def test_host_view_passes_credentials_to_template(self, client, room_code):
        """Host view should pass credentials to template."""
        response = client.get(
            f"/host/{room_code}?player_id=test123&session_token=mysecrettoken"
        )
        assert response.status_code == 200
        # Check that the session token appears in the rendered HTML
        assert b"mysecrettoken" in response.content

    def test_player_view_passes_credentials_to_template(
        self, client, room_code, clean_session_manager
    ):
        """Player view should pass session_token to template."""
        player_id = "test_player_123"
        clean_session_manager.join_room(room_code, player_id, "TestPlayer")

        response = client.get(
            f"/play/{room_code}?player_id={player_id}&session_token=mysecrettoken"
        )
        assert response.status_code == 200
        assert b"mysecrettoken" in response.content
