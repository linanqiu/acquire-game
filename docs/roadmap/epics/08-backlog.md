# Epic 8: Backlog

## Overview

A collection of feature ideas and improvements discovered while using the app. These are not prioritized for any specific release but are captured here for future consideration.

## Purpose

- Capture feature ideas that emerge during gameplay or development
- Prevent good ideas from being lost
- Provide a pool of enhancements for future sprints

## How to Add Items

When you discover a potential improvement while using the app:

1. Create a new story file in `docs/roadmap/stories/08-backlog/`
2. Use prefix `BL-XXX` (e.g., BL-001, BL-002)
3. Set Status to `not-started`
4. Set Priority to `low` (unless clearly higher)
5. Add to the table below

## Stories

| ID | Title | Priority | Effort | Status |
|----|-------|----------|--------|--------|
| [BL-001](../stories/08-backlog/BL-001.md) | Display Other Players' Stock Holdings and Cash | low | S | completed |
| [BL-002](../stories/08-backlog/BL-002.md) | Highlight Player's Tiles on Board | low | S | completed |
| [BL-003](../stories/08-backlog/BL-003.md) | Fix Merger Tile Color Bug | medium | M | completed |
| [BL-004](../stories/08-backlog/BL-004.md) | Event Log for Room Replay | low | L | superseded (by [ES-002](../stories/10-engine-seam/ES-002.md)) |
| [BL-005](../stories/08-backlog/BL-005.md) | Frontend Simplification | low | L | not-started |
| [BL-006](../stories/08-backlog/BL-006.md) | Fix 8th Chain Crash - Display Unplayable Tiles | high | M | completed |
| [BL-007](../stories/08-backlog/BL-007.md) | Game screens: net worth, majorities, merger result, less clutter | high | L | completed |
| [BL-008](../stories/08-backlog/BL-008.md) | Game screens navigate by tabs (sidebar / bottom tab bar) | high | L | completed |
| [BL-009](../stories/08-backlog/BL-009.md) | Visual pass: board shapes, two typefaces, turn signal, motion, calmer palettes, Chains tab, home page, light theme | medium | L | completed |
| [BL-010](../stories/08-backlog/BL-010.md) | Playful AI seat names; one icon badge per AI kind with the model in a popover | medium | M | completed |
| [BL-011](../stories/08-backlog/BL-011.md) | Decision tab: each decision with what is needed to make it (holders, the survivor after a merger, live projection); redirect instead of pop-ups | high | L | completed |
| [BL-012](../stories/08-backlog/BL-012.md) | Public trade offers: everyone sees every offer and its answer, and can make a competing offer to either side | high | M | completed |
| [BL-013](../stories/08-backlog/BL-013.md) | Phone UX pass: players matrix with one chain order, standings and decisions under the board (no Now / Players tabs), merger result that goes by itself, fewer words, trade builder as a sheet | high | L | completed |
| [BL-014](../stories/08-backlog/BL-014.md) | The Board tab fits a real phone screen (390x675: one line per player, small seat icon, the board yields what the table needs, nothing scrolls); a calmer neutral theme with one accent | high | L | completed |
| [BL-015](../stories/08-backlog/BL-015.md) | Merger order: the player who placed the merging tile picks which same-size defunct chain is absorbed first (engine decision, every seat kind, decision panel) | high | L | completed |

## Promotion Process

When a backlog item is ready to be worked on:

1. Assess its dependencies on other epics
2. Move to appropriate epic if it fits, OR
3. Keep here and update priority to `high`
4. Remove from this table when completed
