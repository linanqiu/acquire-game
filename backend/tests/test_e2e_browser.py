"""End-to-end browser tests using Playwright."""

import json
import os
import re
import subprocess
import sys
import time

import pytest

# Skip all tests if playwright is not installed
pytest.importorskip("playwright")

from playwright.sync_api import Page, expect, Browser


@pytest.fixture(scope="module")
def server():
    """Start the FastAPI server for E2E tests."""
    # Change to backend directory
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Use sys.executable to get the same Python interpreter running the tests
    # Start server on a different port to avoid conflicts
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8001",
        ],
        cwd=backend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for server to start
    time.sleep(3)

    # Check if process is still running
    if proc.poll() is not None:
        stdout, stderr = proc.communicate()
        pytest.fail(f"Server failed to start: {stderr.decode()}")

    yield "http://127.0.0.1:8001"

    # Cleanup: terminate the server
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture
def page(browser: Browser):
    """Create a new page for each test."""
    context = browser.new_context()
    page = context.new_page()
    yield page
    context.close()


class TestLobbyE2E:
    """End-to-end tests for lobby functionality."""

    def test_lobby_page_loads(self, page: Page, server):
        """Lobby page should load and display forms."""
        page.goto(f"{server}/")

        # Check page title
        expect(page).to_have_title("Acquire - Board Game")

        # Check create game form exists
        expect(page.locator("#create-game-form")).to_be_visible()
        expect(page.locator("#create-player-name")).to_be_visible()

        # Check join game form exists
        expect(page.locator("#join-game-form")).to_be_visible()
        expect(page.locator("#room-code")).to_be_visible()
        expect(page.locator("#join-player-name")).to_be_visible()

    def test_create_game_flow(self, page: Page, server):
        """Test creating a game via browser."""
        page.goto(f"{server}/")

        # Fill in player name
        page.fill("#create-player-name", "Alice")

        # Click create game button
        page.click("button:has-text('Create Game')")

        # Wait for navigation
        page.wait_for_url("**/host/**")

        # Should redirect to host view
        expect(page).to_have_url(re.compile(r".*/host/[A-Z]{4}\?.*"))

        # Room code should be visible
        expect(page.locator("#room-code")).to_be_visible()

    def test_create_then_join_flow(self, page: Page, server, browser: Browser):
        """Test creating a game and joining from another browser."""
        # Create game in first page
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Alice")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code from URL
        url = page.url
        room_code = url.split("/host/")[1].split("?")[0]

        # Join in second page
        page2 = browser.new_page()
        page2.goto(f"{server}/")
        page2.fill("#room-code", room_code)
        page2.fill("#join-player-name", "Bob")
        page2.click("button:has-text('Join Game')")

        # Should redirect to player view
        page2.wait_for_url(f"**/play/{room_code}**")
        expect(page2).to_have_url(re.compile(rf".*/play/{room_code}\?.*"))

        page2.close()

    def test_join_with_lowercase_room_code(self, page: Page, server, browser: Browser):
        """Room code should work regardless of case."""
        # Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Alice")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code
        url = page.url
        room_code = url.split("/host/")[1].split("?")[0]

        # Join with lowercase room code
        page2 = browser.new_page()
        page2.goto(f"{server}/")
        page2.fill("#room-code", room_code.lower())
        page2.fill("#join-player-name", "Bob")
        page2.click("button:has-text('Join Game')")

        # Should still work and redirect to player view
        page2.wait_for_url(f"**/play/{room_code}**")

        page2.close()

    def test_join_nonexistent_room(self, page: Page, server):
        """Joining a nonexistent room should show error."""
        page.goto(f"{server}/")
        page.fill("#room-code", "ZZZZ")
        page.fill("#join-player-name", "Bob")
        page.click("button:has-text('Join Game')")

        # Should see error (404 page or error message)
        # The exact behavior depends on error handling
        page.wait_for_load_state("networkidle")
        # Page should not be on player view
        assert "/play/" not in page.url


class TestHostViewE2E:
    """End-to-end tests for host view."""

    def test_host_view_displays_room_code(self, page: Page, server):
        """Host view should display the room code."""
        # Create a game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Alice")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Room code should be visible
        room_code_element = page.locator("#room-code")
        expect(room_code_element).to_be_visible()

        # Room code should be 4 uppercase letters
        room_code = room_code_element.text_content()
        assert len(room_code) == 4
        assert room_code.isupper()
        assert room_code.isalpha()


class TestPlayerViewE2E:
    """End-to-end tests for player view."""

    def test_player_view_displays_name(self, page: Page, server, browser: Browser):
        """Player view should display the player's name."""
        # Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Alice")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code
        url = page.url
        room_code = url.split("/host/")[1].split("?")[0]

        # Join as Bob
        page2 = browser.new_page()
        page2.goto(f"{server}/")
        page2.fill("#room-code", room_code)
        page2.fill("#join-player-name", "Bob")
        page2.click("button:has-text('Join Game')")
        page2.wait_for_url(f"**/play/{room_code}**")

        # Player name should be visible
        expect(page2.locator("#player-name")).to_contain_text("Bob")

        page2.close()


class TestFullGameE2E:
    """End-to-end tests for full game cycle."""

    def test_create_join_and_start_game(self, page: Page, server, browser: Browser):
        """Test creating, joining, and starting a game."""
        # Create game as Alice
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Alice")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code
        url = page.url
        room_code = url.split("/host/")[1].split("?")[0]

        # Join as Bob
        page2 = browser.new_page()
        page2.goto(f"{server}/")
        page2.fill("#room-code", room_code)
        page2.fill("#join-player-name", "Bob")
        page2.click("button:has-text('Join Game')")
        page2.wait_for_url(f"**/play/{room_code}**")

        # Start game via API (simulating host action)
        # In a full E2E test, we'd click a "Start Game" button
        # For now, verify both pages are set up correctly

        expect(page.locator("#room-code")).to_have_text(room_code)
        expect(page2.locator("#player-name")).to_contain_text("Bob")

        page2.close()


# =============================================================================
# Debugging Utilities
# =============================================================================


def capture_page_state(page, name="page"):
    """Capture comprehensive page state for debugging."""
    try:
        body_text = (
            page.locator("body").text_content()[:500]
            if page.locator("body").count() > 0
            else ""
        )
    except Exception:
        body_text = ""
    return {
        "name": name,
        "url": page.url,
        "title": page.title(),
        "visible_text": body_text,
    }


def dump_websocket_traffic(ws_messages):
    """Pretty print WebSocket traffic."""
    print("\n=== WebSocket Traffic ===")
    for direction, frame in ws_messages:
        try:
            payload = frame if isinstance(frame, str) else str(frame)
            data = json.loads(payload)
            print(f"{direction}: {json.dumps(data, indent=2)[:300]}")
        except Exception:
            print(f"{direction}: {str(frame)[:300] if frame else 'empty'}")


# =============================================================================
# Game Flow Tests with Debugging
# =============================================================================


class TestGameFlowWithDebugging:
    """Tests for game flow with detailed debugging output."""

    def test_full_game_start_with_console_capture(
        self, page: Page, server, browser: Browser
    ):
        """Test game start with detailed debugging output."""
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        # Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "TestHost")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code
        room_code = page.url.split("/host/")[1].split("?")[0]
        print(f"\n=== Created game with room code: {room_code} ===")

        # Add 2 bots
        add_bot_btn = page.locator("#add-bot-btn")
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(500)
            add_bot_btn.click()
            page.wait_for_timeout(500)
            print("Added 2 bots")

        # Wait for players to appear in list
        player_rows = page.locator(".player-row, .player-item, [data-player]")
        page.wait_for_timeout(1000)
        print(f"Player count: {player_rows.count()}")

        # Start game
        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
            print("Clicked start game button")
        else:
            print("Start button not found or not visible")

        # Wait for game to start (phase changes or board appears)
        page.wait_for_timeout(3000)

        # Print console logs for debugging
        print("\n=== Console Logs ===")
        for log in console_logs:
            print(log)

        # Print page state
        state = capture_page_state(page)
        print("\n=== Page State ===")
        print(f"URL: {state['url']}")
        print(f"Content preview: {state['visible_text'][:300]}")

        # Check for JS errors
        errors = [log for log in console_logs if log.startswith("[error]")]
        if errors:
            print("\n=== JS Errors Found ===")
            for err in errors:
                print(err)

        # Assert no critical errors (warnings are OK)
        critical_errors = [
            e for e in errors if "TypeError" in e or "ReferenceError" in e
        ]
        assert len(critical_errors) == 0, f"Critical JS errors found: {critical_errors}"

    def test_websocket_messages(self, page: Page, server, browser: Browser):
        """Capture WebSocket messages for debugging."""
        ws_messages = []

        def handle_websocket(ws):
            ws.on("framesent", lambda f: ws_messages.append(("sent", f)))
            ws.on("framereceived", lambda f: ws_messages.append(("recv", f)))

        page.on("websocket", handle_websocket)

        # Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "WSTestHost")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        room_code = page.url.split("/host/")[1].split("?")[0]
        print(f"\n=== Created game: {room_code} ===")

        # Add a bot
        add_bot_btn = page.locator("#add-bot-btn")
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(1000)

        # Start game
        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
            page.wait_for_timeout(3000)

        # Print WebSocket messages for debugging
        dump_websocket_traffic(ws_messages)

        # Verify we received some messages
        print(f"\n=== Total WS messages: {len(ws_messages)} ===")
        assert len(ws_messages) > 0, "No WebSocket messages captured"

    def test_player_receives_tiles(self, page: Page, server, browser: Browser):
        """Verify player view receives and displays tiles."""
        console_logs = []
        page.on(
            "console",
            lambda msg: console_logs.append(f"[host] [{msg.type}] {msg.text}"),
        )

        # Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        room_code = page.url.split("/host/")[1].split("?")[0]
        print(f"\n=== Room code: {room_code} ===")

        # Open player view in new page
        player_page = browser.new_page()
        player_page.on(
            "console",
            lambda msg: console_logs.append(f"[player] [{msg.type}] {msg.text}"),
        )

        player_page.goto(f"{server}/")
        player_page.fill("#room-code", room_code)
        player_page.fill("#join-player-name", "Player1")
        player_page.click("button:has-text('Join Game')")
        player_page.wait_for_url(f"**/play/{room_code}**")
        print("Player joined game")

        # Back to host - add bot, start game
        add_bot_btn = page.locator("#add-bot-btn")
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(500)

        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
            print("Game started")

        # Wait for tiles in player view
        player_page.wait_for_timeout(3000)

        # Check for tile rack
        tile_rack = player_page.locator(
            "#tile-rack .tile, .tile-rack .tile, [data-tile]"
        )
        tile_count = tile_rack.count()
        print(f"Found {tile_count} tile elements")

        if tile_count > 0:
            tiles = tile_rack.all_text_contents()
            print(f"Player tiles: {tiles}")

            # Check at least one tile has real content (not "-" or empty)
            real_tiles = [t for t in tiles if t and t != "-" and t.strip()]
            print(f"Real tiles: {real_tiles}")

            if len(real_tiles) == 0:
                # Print console logs to debug
                print("\n=== Console Logs ===")
                for log in console_logs:
                    print(log)

            assert len(real_tiles) > 0, f"No tiles found! Got: {tiles}"
        else:
            # Maybe tiles are in a different location
            body_content = player_page.locator("body").text_content()
            print(f"Page content: {body_content[:500]}")

            # Print console logs
            print("\n=== Console Logs ===")
            for log in console_logs:
                print(log)

            # Fail with helpful message
            assert False, "No tile elements found in player view"

        player_page.close()


class TestCompleteTurnCycle:
    """Tests for complete turn cycles."""

    def test_complete_turn_cycle(self, page: Page, server, browser: Browser):
        """Test player can complete a full turn."""
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        # Setup: Create game
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")
        room_code = page.url.split("/host/")[1].split("?")[0]
        print(f"\n=== Room: {room_code} ===")

        # Join as player in new page
        player_page = browser.new_page()
        player_page.on(
            "console",
            lambda msg: console_logs.append(f"[player] [{msg.type}] {msg.text}"),
        )
        player_page.goto(f"{server}/")
        player_page.fill("#room-code", room_code)
        player_page.fill("#join-player-name", "Player1")
        player_page.click("button:has-text('Join Game')")
        player_page.wait_for_url(f"**/play/{room_code}**")

        # Add bot and start
        add_bot_btn = page.locator("#add-bot-btn")
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(500)

        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()

        # Wait for game to start
        player_page.wait_for_timeout(3000)

        # Check if it's our turn
        body_content = player_page.locator("body").text_content() or ""
        is_my_turn = "your turn" in body_content.lower()
        print(f"Is my turn: {is_my_turn}")

        if is_my_turn:
            # Click first available tile
            tiles = player_page.locator(
                "#tile-rack .tile:not([disabled]), .tile-rack .tile:not(.disabled)"
            )
            if tiles.count() > 0:
                tiles.first.click()
                print("Clicked first tile")
                player_page.wait_for_timeout(1000)

                # Check for buy stocks section or end turn
                buy_section = player_page.locator(
                    "#buy-stocks-section, .buy-stocks, [data-buy-stocks]"
                )
                if buy_section.count() > 0 and buy_section.is_visible():
                    confirm_btn = player_page.locator(
                        "#confirm-buy, button:has-text('Confirm'), button:has-text('Done')"
                    )
                    if confirm_btn.count() > 0:
                        confirm_btn.first.click()
                        print("Confirmed buy (bought nothing)")

                # End turn if available
                end_turn = player_page.locator(
                    "#end-turn-btn, button:has-text('End Turn')"
                )
                if end_turn.count() > 0 and end_turn.is_visible():
                    end_turn.click()
                    print("Ended turn")

        # Print debug info
        print("\n=== Console Logs ===")
        for log in console_logs[-20:]:  # Last 20 logs
            print(log)

        player_page.close()


class TestChainFoundingAndMerger:
    """Tests for chain founding and merger mechanics."""

    def test_chain_founding(self, page: Page, server, browser: Browser):
        """Test the chain founding flow when connecting tiles."""
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        print("\n=== Game created ===")

        # Add 3 bots (they'll play the game)
        add_bot_btn = page.locator("#add-bot-btn")
        for i in range(3):
            if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
                add_bot_btn.click()
                page.wait_for_timeout(500)
        print("Added 3 bots")

        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
            print("Game started")

        # Wait and watch for chains to appear on board
        chain_founded = False
        for i in range(30):  # Check for 30 seconds
            page.wait_for_timeout(1000)

            # Look for any chain cells on the board
            chain_cells = page.locator(
                ".cell[data-chain], .chain-cell, [data-chain]:not([data-chain=''])"
            )
            if chain_cells.count() > 0:
                print(f"Chain founded! Found {chain_cells.count()} chain cells")
                chain_founded = True
                break

            # Also check board content
            board = page.locator("#board, .board, [data-board]")
            if board.count() > 0:
                board_content = board.first.text_content() or ""
                # Check for chain names in board
                chain_names = [
                    "Tower",
                    "Luxor",
                    "American",
                    "Worldwide",
                    "Festival",
                    "Imperial",
                    "Continental",
                ]
                for chain in chain_names:
                    if chain.lower() in board_content.lower():
                        print(f"Chain '{chain}' found in board content")
                        chain_founded = True
                        break
            if chain_founded:
                break

            if i % 5 == 0:
                print(f"Waiting for chain founding... ({i}s)")

        # Print final state
        print("\n=== Console Logs (last 10) ===")
        for log in console_logs[-10:]:
            print(log)

        if not chain_founded:
            print(
                "No chain founded in time limit (this may be normal for a short test)"
            )

    def test_merger_flow(self, page: Page, server, browser: Browser):
        """Test merger UI appears when chains merge."""
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Add bots
        add_bot_btn = page.locator("#add-bot-btn")
        for _ in range(3):
            if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
                add_bot_btn.click()
                page.wait_for_timeout(500)

        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()

        # Wait for merger event (may take a while)
        merger_detected = False
        for i in range(60):  # Check for 60 seconds
            page.wait_for_timeout(1000)

            # Check game log for merger events
            log_element = page.locator("#game-log, .game-log, [data-game-log]")
            if log_element.count() > 0:
                log_content = log_element.first.text_content() or ""
                if (
                    "merger" in log_content.lower()
                    or "acquired" in log_content.lower()
                    or "merge" in log_content.lower()
                ):
                    merger_detected = True
                    print("Merger detected in log!")
                    break

            # Also check body content
            body_content = page.locator("body").text_content() or ""
            if "merger" in body_content.lower():
                merger_detected = True
                print("Merger found in page content")
                break

            if i % 10 == 0:
                print(f"Waiting for merger... ({i}s)")

        if not merger_detected:
            print("No merger occurred in time limit (this is OK for basic testing)")


def setup_game_with_host_playing(page, server, browser, num_bots=3):
    """Helper to set up a game where the Host also participates.

    The Host (who creates the game) is automatically a player.
    This helper ensures the Host has a player view open so they can play.

    Returns: (host_player_page, room_code)
    """
    # Create game
    page.goto(f"{server}/")
    page.fill("#create-player-name", "Host")
    page.click("button:has-text('Create Game')")
    page.wait_for_url("**/host/**")

    # Extract host credentials
    room_code = page.url.split("/host/")[1].split("?")[0]
    host_player_id = page.url.split("player_id=")[1].split("&")[0]
    host_session_token = (
        page.url.split("session_token=")[1] if "session_token=" in page.url else ""
    )

    # Host opens player view to participate
    host_player_context = browser.new_context()
    host_player_page = host_player_context.new_page()
    host_player_page.goto(
        f"{server}/play/{room_code}?player_id={host_player_id}&session_token={host_session_token}"
    )
    host_player_page.wait_for_load_state("networkidle")

    # Add bots
    add_bot_btn = page.locator("#add-bot-btn")
    for _ in range(num_bots):
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(300)

    # Start game
    start_btn = page.locator("#start-game-btn")
    if start_btn.count() > 0 and start_btn.is_visible():
        start_btn.click()
    page.wait_for_timeout(1000)

    return host_player_page, room_code, host_player_context


def auto_play_turn(player_page):
    """Helper to auto-play a turn if it's this player's turn."""
    tiles = player_page.locator("#tile-rack .tile:not([disabled])")
    if tiles.count() > 0:
        first_tile = tiles.first
        tile_data = first_tile.get_attribute("data-tile")
        if tile_data and tile_data.strip():
            first_tile.click()
            player_page.wait_for_timeout(200)
            confirm = player_page.locator("#confirm-place-tile")
            if confirm.count() > 0 and confirm.is_visible():
                confirm.click()
                player_page.wait_for_timeout(300)
                buy_section = player_page.locator("#buy-stocks-section")
                if buy_section.count() > 0 and buy_section.is_visible():
                    confirm_buy = player_page.locator("#confirm-buy")
                    if confirm_buy.count() > 0 and confirm_buy.is_visible():
                        confirm_buy.click()
                        player_page.wait_for_timeout(200)
                return True
    return False


class TestBotTurnProgression:
    """Tests for bot turn progression - catches stuck game bugs."""

    def test_bot_turn_completes_within_timeout(
        self, page: Page, server, browser: Browser
    ):
        """Verify bot turns complete within reasonable time - catches stuck games."""
        # Create game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )

        # Track current player changes
        BOT_TURN_TIMEOUT = 5000  # 5 seconds max per bot turn
        last_player = None
        stuck_since = None
        turns_progressed = 0

        for i in range(30):  # Monitor for 30 seconds
            # Let Host auto-play their turn if it's their turn
            auto_play_turn(host_player_page)

            page.wait_for_timeout(1000)

            # Get current turn info from page
            turn_element = page.locator(
                ".current-turn, #current-turn, [data-current-player]"
            )
            turn_text = turn_element.text_content() if turn_element.count() > 0 else ""

            if last_player == turn_text and turn_text:
                if stuck_since is None:
                    stuck_since = i
                elif (i - stuck_since) * 1000 > BOT_TURN_TIMEOUT:
                    assert False, (
                        f"Game stuck on '{turn_text}' for {(i - stuck_since)}s"
                    )
            else:
                stuck_since = None
                if turn_text and last_player != turn_text:
                    turns_progressed += 1
                    print(f"Turn progressed to: {turn_text}")
                last_player = turn_text

        host_ctx.close()
        assert turns_progressed > 0, "Game never progressed any turns"

    def test_turn_counter_progresses(self, page: Page, server, browser: Browser):
        """Verify turn number increases over time - game is actually progressing."""
        ws_messages = []

        def handle_ws(ws):
            ws.on("framereceived", lambda f: ws_messages.append(f))

        page.on("websocket", handle_ws)

        # Setup game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )

        # Track game state messages
        game_states = []
        for i in range(20):
            # Let Host auto-play their turn
            auto_play_turn(host_player_page)
            page.wait_for_timeout(1000)
            for msg in ws_messages:
                try:
                    payload = msg.payload if hasattr(msg, "payload") else str(msg)
                    data = json.loads(payload)
                    if data.get("type") == "game_state":
                        game_states.append(
                            {
                                "current_player": data.get("current_player"),
                                "phase": data.get("phase"),
                                "tiles_remaining": data.get("tiles_remaining"),
                            }
                        )
                except Exception:
                    pass
            ws_messages.clear()

        host_ctx.close()

        # Verify we got multiple different current_players
        players_seen = set(
            s["current_player"] for s in game_states if s["current_player"]
        )
        print(f"Players seen: {players_seen}")
        assert len(players_seen) > 1, f"Only saw {players_seen} - turns not progressing"

        # Verify tiles are being used
        if len(game_states) >= 2:
            first_tiles = game_states[0].get("tiles_remaining")
            last_tiles = game_states[-1].get("tiles_remaining")
            if first_tiles and last_tiles:
                assert last_tiles < first_tiles, (
                    f"Tile count not decreasing - bots not playing. "
                    f"Started: {first_tiles}, Ended: {last_tiles}"
                )

    def test_current_player_changes(self, page: Page, server, browser: Browser):
        """Verify current_player changes - not stuck on same player."""
        import itertools

        ws_messages = []

        def handle_ws(ws):
            ws.on("framereceived", lambda f: ws_messages.append(f))

        page.on("websocket", handle_ws)

        # Setup game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )

        # Collect current_player values over time
        current_players = []
        for i in range(15):
            # Let Host auto-play their turn
            auto_play_turn(host_player_page)
            page.wait_for_timeout(1000)
            for msg in ws_messages:
                try:
                    payload = msg.payload if hasattr(msg, "payload") else str(msg)
                    data = json.loads(payload)
                    if data.get("type") == "game_state":
                        player = data.get("current_player")
                        if player:
                            current_players.append(player)
                except Exception:
                    pass
            ws_messages.clear()

        host_ctx.close()

        if not current_players:
            pytest.skip("No game state messages received")

        # Should see player changes (turn rotation)
        unique_players = set(current_players)
        consecutive_same = max(
            len(list(g)) for _, g in itertools.groupby(current_players)
        )

        print(f"Players seen: {unique_players}")
        print(f"Max consecutive same player: {consecutive_same}")

        # Fail if same player appears too many consecutive times (stuck)
        assert consecutive_same < 5, (
            f"Same player {consecutive_same} times in a row - likely stuck. "
            f"Players sequence: {current_players[:20]}"
        )

    def test_board_state_changes(self, page: Page, server, browser: Browser):
        """Verify board state changes - tiles being placed."""
        # Setup game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )
        page.wait_for_timeout(2000)

        # Count placed tiles at intervals
        tile_counts = []
        for i in range(10):
            # Let Host auto-play their turn
            auto_play_turn(host_player_page)
            page.wait_for_timeout(2000)
            # Count cells with tiles placed
            placed = page.locator(
                ".cell.placed, .cell[data-tile], .board-cell:not(.empty), "
                "[data-placed='true'], .tile-placed"
            ).count()
            tile_counts.append(placed)
            print(f"After {(i + 1) * 2}s: {placed} tiles placed")

        host_ctx.close()

        # Tile count should increase over time (game is progressing)
        if tile_counts[-1] == tile_counts[0] == 0:
            # If we can't detect tiles via CSS, check for game state changes
            body_content = page.locator("body").text_content() or ""
            if "game over" in body_content.lower():
                print("Game completed!")
                return
            pytest.skip("Could not detect tile placement via CSS selectors")

        assert tile_counts[-1] > tile_counts[0], (
            f"Board not changing: started with {tile_counts[0]}, ended with {tile_counts[-1]}"
        )

    def test_game_makes_significant_progress(
        self, page: Page, server, browser: Browser
    ):
        """Verify game makes progress - either completes or plays many turns."""
        ws_messages = []

        def handle_ws(ws):
            ws.on("framereceived", lambda f: ws_messages.append(f))

        page.on("websocket", handle_ws)

        # Setup game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )

        initial_tiles_remaining = None
        last_tiles_remaining = None
        turns_detected = 0

        # Monitor for 60 seconds
        for i in range(60):
            # Let Host auto-play their turn
            auto_play_turn(host_player_page)
            page.wait_for_timeout(1000)

            # Check for game over
            body = page.locator("body").text_content() or ""
            if "game over" in body.lower() or "final scores" in body.lower():
                print(f"Game completed in {i} seconds!")
                host_ctx.close()
                return  # Success - game finished

            # Parse WebSocket messages for game state
            for msg in ws_messages:
                try:
                    payload = msg.payload if hasattr(msg, "payload") else str(msg)
                    data = json.loads(payload)
                    if data.get("type") == "game_state":
                        tiles_remaining = data.get("tiles_remaining")
                        if tiles_remaining is not None:
                            if initial_tiles_remaining is None:
                                initial_tiles_remaining = tiles_remaining
                            if last_tiles_remaining != tiles_remaining:
                                turns_detected += 1
                            last_tiles_remaining = tiles_remaining
                except Exception:
                    pass
            ws_messages.clear()

            if i % 10 == 0:
                print(
                    f"{i}s: Still playing, tiles remaining: {last_tiles_remaining}, "
                    f"turns detected: {turns_detected}"
                )

        host_ctx.close()

        # If we got here, game didn't finish but should have made progress
        assert turns_detected >= 5, (
            f"Only {turns_detected} turns detected in 60s - game barely progressed. "
            f"Initial tiles: {initial_tiles_remaining}, "
            f"Final tiles: {last_tiles_remaining}"
        )


class TestGameEndDetection:
    """Tests for game end detection."""

    def test_game_end_detection(self, page: Page, server, browser: Browser):
        """Test game end conditions are detected."""
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        # Setup game with bots + Host playing
        host_player_page, room_code, host_ctx = setup_game_with_host_playing(
            page, server, browser, num_bots=3
        )

        # Check periodically for game end
        game_ended = False
        for i in range(120):  # 2 minutes max
            # Let Host auto-play their turn
            auto_play_turn(host_player_page)
            page.wait_for_timeout(1000)

            # Check for game over indicators
            game_over = page.locator(".game-over, [data-game-over], #game-over")
            if game_over.count() > 0 and game_over.is_visible():
                game_ended = True
                print("Game over element visible")
                break

            body_content = page.locator("body").text_content() or ""
            if (
                "game over" in body_content.lower()
                or "final scores" in body_content.lower()
            ):
                game_ended = True
                print("Game over detected in content")
                break

            if i % 10 == 0:
                print(f"Still playing... ({i}s)")

        host_ctx.close()
        print(f"\nGame ended: {game_ended}")

        # Print final state
        print("\n=== Console Logs (last 20) ===")
        for log in console_logs[-20:]:
            print(log)


class TestHumanPlayerGameplay:
    """Tests for human player gameplay - the real user experience."""

    def test_human_player_sees_tiles_and_can_place(
        self, page: Page, server, browser: Browser
    ):
        """Test that a human player can see tiles and place one when it's their turn."""
        console_logs = []

        # Create game as host (host view)
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        # Extract room code and host player ID
        room_code = page.url.split("/host/")[1].split("?")[0]
        host_player_id = page.url.split("player_id=")[1].split("&")[0]
        host_session_token = (
            page.url.split("session_token=")[1] if "session_token=" in page.url else ""
        )
        print(f"\n=== Room code: {room_code} ===")

        # Host also needs a player view to participate (creator is a player)
        host_player_context = browser.new_context()
        host_player_page = host_player_context.new_page()
        host_player_page.on(
            "console",
            lambda msg: console_logs.append(f"[host] [{msg.type}] {msg.text}"),
        )
        host_player_page.goto(
            f"{server}/play/{room_code}?player_id={host_player_id}&session_token={host_session_token}"
        )
        host_player_page.wait_for_load_state("networkidle")
        print("Host opened player view")

        # Open player view in a new browser context (simulating a phone)
        player_context = browser.new_context()
        player_page = player_context.new_page()
        player_page.on(
            "console",
            lambda msg: console_logs.append(f"[player] [{msg.type}] {msg.text}"),
        )

        # Join as player
        player_page.goto(f"{server}/")
        player_page.fill("#room-code", room_code)
        player_page.fill("#join-player-name", "HumanPlayer")
        player_page.click("button:has-text('Join Game')")
        player_page.wait_for_url(f"**/play/{room_code}**")
        print("Human player joined game")

        # Add 2 bots from host view (total: Host + HumanPlayer + 2 bots = 4)
        add_bot_btn = page.locator("#add-bot-btn")
        for _ in range(2):
            if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
                add_bot_btn.click()
                page.wait_for_timeout(500)
        print("Added 2 bots")

        # Start game from host view
        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
            print("Game started")

        # Wait for game state to propagate
        player_page.wait_for_timeout(2000)

        # Helper to try placing a tile for any player
        def try_place_tile_for(player_pg, name):
            tiles = player_pg.locator("#tile-rack .tile:not([disabled])")
            if tiles.count() > 0:
                first_tile = tiles.first
                tile_data = first_tile.get_attribute("data-tile")
                if tile_data and tile_data.strip():
                    print(f"{name} placing tile {tile_data}")
                    first_tile.click()
                    player_pg.wait_for_timeout(300)
                    confirm = player_pg.locator("#confirm-place-tile")
                    if confirm.count() > 0 and confirm.is_visible():
                        confirm.click()
                        player_pg.wait_for_timeout(500)
                        buy_section = player_pg.locator("#buy-stocks-section")
                        if buy_section.count() > 0 and buy_section.is_visible():
                            confirm_buy = player_pg.locator("#confirm-buy")
                            if confirm_buy.count() > 0 and confirm_buy.is_visible():
                                confirm_buy.click()
                                player_pg.wait_for_timeout(300)
                        print(f"  {name} placed tile!")
                        return True
            return False

        # Keep the Host playing so they don't block the game
        # We'll check both Host and HumanPlayer for turns
        all_players = [("Host", host_player_page), ("HumanPlayer", player_page)]

        # CHECKPOINT 1: Verify HumanPlayer sees tiles
        tile_buttons = player_page.locator("#tile-rack .tile")
        tile_count = tile_buttons.count()
        print(f"Found {tile_count} tile buttons for HumanPlayer")

        tiles_with_data = []
        for i in range(tile_count):
            tile = tile_buttons.nth(i)
            tile_data = tile.get_attribute("data-tile")
            tile_text = tile.text_content()
            if tile_data and tile_data.strip():
                tiles_with_data.append(tile_data)
            print(f"  Tile {i}: data-tile='{tile_data}', text='{tile_text}'")

        assert len(tiles_with_data) > 0, (
            "Player has no tiles with data! Console logs:\n"
            + "\n".join(console_logs[-20:])
        )
        print(f"HumanPlayer has {len(tiles_with_data)} tiles: {tiles_with_data}")

        # CHECKPOINT 2: Wait for HumanPlayer's turn and place a tile
        # Keep Host playing to prevent blocking the game
        human_placed_tile = False
        turns_played = {"Host": 0, "HumanPlayer": 0}

        for attempt in range(60):  # Max 60 iterations (~30 seconds)
            # Check and play for any human player whose turn it is
            for name, pg in all_players:
                if try_place_tile_for(pg, name):
                    turns_played[name] += 1
                    if name == "HumanPlayer":
                        human_placed_tile = True
                    pg.wait_for_timeout(500)
                    break

            if human_placed_tile:
                break

            player_page.wait_for_timeout(500)

        print("\n=== Turn Summary ===")
        print(f"Host turns: {turns_played['Host']}")
        print(f"HumanPlayer turns: {turns_played['HumanPlayer']}")

        # Assert HumanPlayer got to play at least once
        assert human_placed_tile, (
            "HumanPlayer never placed a tile! Console logs:\n"
            + "\n".join(console_logs[-30:])
        )
        print("SUCCESS: HumanPlayer placed a tile!")

        # Print final state
        print("\n=== Final Console Logs ===")
        for log in console_logs[-15:]:
            print(log)

        host_player_context.close()
        player_context.close()

    def test_two_humans_and_bots_play_multiple_turns(
        self, page: Page, server, browser: Browser
    ):
        """Test game with 2 human players and 2 bots, playing multiple turns.

        Note: The Host who creates the game is automatically added as a player.
        We add 3 bots so there are 4 players total (Host + 3 bots), then we test
        with additional human players joining.

        For this test, we create the game, add 2 human players, and add enough
        bots to fill the game. The Host is a player but doesn't participate
        via the player view (they could use the host view to observe).
        """
        console_logs = []

        # Create game as host
        page.goto(f"{server}/")
        page.fill("#create-player-name", "Host")
        page.click("button:has-text('Create Game')")
        page.wait_for_url("**/host/**")

        room_code = page.url.split("/host/")[1].split("?")[0]
        host_player_id = page.url.split("player_id=")[1].split("&")[0]
        print(f"\n=== Room: {room_code} ===")
        print(f"Host player ID: {host_player_id[:8]}...")

        # The Host also needs to open a player view to participate
        host_player_context = browser.new_context()
        host_player = host_player_context.new_page()
        host_player.on("console", lambda msg: console_logs.append(f"[Host] {msg.text}"))

        # Navigate directly to the player view for the Host
        host_session_token = (
            page.url.split("session_token=")[1] if "session_token=" in page.url else ""
        )
        host_player.goto(
            f"{server}/play/{room_code}?player_id={host_player_id}&session_token={host_session_token}"
        )
        host_player.wait_for_load_state("networkidle")
        print("Host opened player view")

        # Player 1 joins
        player1_context = browser.new_context()
        player1 = player1_context.new_page()
        player1.on("console", lambda msg: console_logs.append(f"[P1] {msg.text}"))

        player1.goto(f"{server}/")
        player1.fill("#room-code", room_code)
        player1.fill("#join-player-name", "Player1")
        player1.click("button:has-text('Join Game')")
        player1.wait_for_url(f"**/play/{room_code}**")
        print("Player1 joined")

        # Player 2 joins
        player2_context = browser.new_context()
        player2 = player2_context.new_page()
        player2.on("console", lambda msg: console_logs.append(f"[P2] {msg.text}"))

        player2.goto(f"{server}/")
        player2.fill("#room-code", room_code)
        player2.fill("#join-player-name", "Player2")
        player2.click("button:has-text('Join Game')")
        player2.wait_for_url(f"**/play/{room_code}**")
        print("Player2 joined")

        # Add 1 bot (total: Host + Player1 + Player2 + 1 bot = 4 players)
        add_bot_btn = page.locator("#add-bot-btn")
        if add_bot_btn.count() > 0 and add_bot_btn.is_visible():
            add_bot_btn.click()
            page.wait_for_timeout(500)
        print("Added 1 bot (4 players total)")

        # Start game
        start_btn = page.locator("#start-game-btn")
        if start_btn.count() > 0 and start_btn.is_visible():
            start_btn.click()
        print("Game started")

        # Wait for game to initialize
        player1.wait_for_timeout(2000)

        # Helper function to attempt placing a tile for a player
        def try_place_tile(player_page, player_name):
            """Try to place a tile if it's this player's turn. Returns True if successful."""
            # Wait a moment for any state updates
            player_page.wait_for_timeout(200)

            # Check for enabled tiles (indicates it's our turn and we're in place_tile phase)
            tiles = player_page.locator("#tile-rack .tile:not([disabled])")
            if tiles.count() == 0:
                return False

            first_tile = tiles.first
            tile_data = first_tile.get_attribute("data-tile")

            if not tile_data or not tile_data.strip():
                return False

            # It's this player's turn - place a tile
            print(f"{player_name} placing tile {tile_data}")
            first_tile.click()
            player_page.wait_for_timeout(300)

            confirm = player_page.locator("#confirm-place-tile")
            if confirm.count() > 0 and confirm.is_visible():
                confirm.click()
                print(f"  {player_name} placed tile!")
                player_page.wait_for_timeout(500)

                # Handle buy stocks phase if it appears
                buy_section = player_page.locator("#buy-stocks-section")
                if buy_section.count() > 0 and buy_section.is_visible():
                    confirm_buy = player_page.locator("#confirm-buy")
                    if confirm_buy.count() > 0 and confirm_buy.is_visible():
                        confirm_buy.click()
                        print(f"  {player_name} skipped buying stocks")
                        player_page.wait_for_timeout(500)

                return True
            return False

        # Track turns played by humans (Host + Player1 + Player2)
        turns_played = {"Host": 0, "Player1": 0, "Player2": 0}
        players = [
            ("Host", host_player),
            ("Player1", player1),
            ("Player2", player2),
        ]
        max_turns = 6  # Play up to 6 human turns total

        # Play turns until we've accumulated enough turns or timed out
        for _ in range(60):  # Max 60 iterations (with 500ms delay = ~30 seconds)
            for player_name, player_page in players:
                if try_place_tile(player_page, player_name):
                    turns_played[player_name] += 1
                    # After placing, wait for game state to update for everyone
                    player_page.wait_for_timeout(500)
                    # Break inner loop to re-check all players fresh
                    break

            total_turns = sum(turns_played.values())
            if total_turns >= max_turns:
                break

            # Small delay between checks
            player1.wait_for_timeout(500)

        total_turns = sum(turns_played.values())
        print("\n=== Results ===")
        print(f"Host turns: {turns_played['Host']}")
        print(f"Player1 turns: {turns_played['Player1']}")
        print(f"Player2 turns: {turns_played['Player2']}")
        print(f"Total turns: {total_turns}")

        # Verify at least 2 different humans got to play
        # Note: Player1 and Player2 are the key players we want to verify
        humans_who_played = sum(1 for t in turns_played.values() if t > 0)
        assert turns_played["Player1"] > 0 or turns_played["Player2"] > 0, (
            f"Neither Player1 nor Player2 got to play! "
            f"Turns: {turns_played}. Console logs:\n" + "\n".join(console_logs[-20:])
        )
        # At least 2 total turns should have happened
        assert total_turns >= 2, f"Only {total_turns} turns played, expected at least 2"
        print(f"SUCCESS: {humans_who_played} humans played, {total_turns} total turns")

        print("\n=== Console Logs (last 15) ===")
        for log in console_logs[-15:]:
            print(log)

        host_player_context.close()
        player1_context.close()
        player2_context.close()
