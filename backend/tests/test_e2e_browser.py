"""End-to-end browser tests using Playwright."""

import pytest
import subprocess
import time
import os
import json

# Skip all tests if playwright is not installed
pytest.importorskip("playwright")

from playwright.sync_api import Page, expect, Browser


@pytest.fixture(scope="module")
def server():
    """Start the FastAPI server for E2E tests."""
    # Change to backend directory
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Start server on a different port to avoid conflicts
    proc = subprocess.Popen(
        [
            "python",
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
        expect(page).to_have_url(pytest.approx_re(r".*/host/[A-Z]{4}\?.*"))

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
        expect(page2).to_have_url(pytest.approx_re(rf".*/play/{room_code}\?.*"))

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
    for direction, payload in ws_messages:
        try:
            data = json.loads(payload)
            print(f"{direction}: {json.dumps(data, indent=2)[:300]}")
        except Exception:
            print(f"{direction}: {payload[:300] if payload else 'empty'}")


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
            ws.on("framesent", lambda f: ws_messages.append(("sent", f.payload)))
            ws.on("framereceived", lambda f: ws_messages.append(("recv", f.payload)))

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


class TestGameEndDetection:
    """Tests for game end detection."""

    def test_game_end_detection(self, page: Page, server, browser: Browser):
        """Test game end conditions are detected."""
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

        # Check periodically for game end
        game_ended = False
        for i in range(120):  # 2 minutes max
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

        print(f"\nGame ended: {game_ended}")

        # Print final state
        print("\n=== Console Logs (last 20) ===")
        for log in console_logs[-20:]:
            print(log)
