/**
 * Real server messages for unit tests (see generate_wire_messages.py: recorded from the live
 * backend, never hand-written). Tests feed them through the real store handler, so the UI gets
 * exactly the state a player's browser would.
 */

import raw from './wire-messages.json'
import { useGameStore } from '../../../src/store/gameStore'
import { useRulesetStore } from '../../../src/ruleset/store'
import type { Ruleset } from '../../../src/types/ruleset'
import { ALL_RULESETS } from './rulesets'

export type RulesetName = 'default' | 'valley' | 'mini'
export type SnapshotName = keyof typeof raw.snapshots

export interface SnapshotView {
  description: string
  /** The human seat's player id (the "Alice" of the fixture). */
  human: string
  seats: Record<string, string>
  /** What the seat receives, in order (prompts, game_state, game_over). */
  player: Array<Record<string, any>>
  /** The spectator's game_state. */
  host: Record<string, any>
  /** What the server sent after the human sold everything (only for one fixture). */
  after_disposition: Array<Record<string, any>>
  /** The generator's expectations, derived from the engine. */
  expect: Record<string, any>
}

export const SNAPSHOT_NAMES = Object.keys(raw.snapshots) as SnapshotName[]

export function snapshot(name: SnapshotName): SnapshotView {
  return structuredClone(raw.snapshots[name]) as SnapshotView
}

export function playerState(name: SnapshotName): Record<string, any> {
  return snapshot(name).player.find((m) => m.type === 'game_state')!
}

export interface PlayedGame {
  /** First game_state for each `phase/decision` the human faced. */
  states: Record<string, Record<string, any>>
  prompts: Record<string, Record<string, any>>
  final: Record<string, any>
  game_over: Record<string, any>
}

/** The messages of a trade's lifecycle, as the server sent them (accepted, rejected, canceled, proposed). */
export function wireTrades() {
  return structuredClone(raw.trades) as Record<
    'accepted' | 'rejected' | 'canceled' | 'proposed',
    Record<string, any>
  > & {
    /**
     * What a player (`human`) received about offers between two OTHER players (`from`, `to`):
     * `state` (the offer open), then the offer rejected, proposed again, cancelled, proposed
     * and accepted, and `state_after`.
     */
    others: Record<
      'state' | 'rejected' | 'proposed' | 'canceled' | 'accepted' | 'state_after',
      Record<string, any>
    > & { from: string; to: string; human: string }
  }
}

/** What the home page's routes answered (status + body): create, join, spectator, show, each
 *  refusal. */
export function wireHome() {
  return structuredClone(raw.home) as Record<
    | 'create'
    | 'join'
    | 'spectator'
    | 'show'
    | 'join_unknown_room'
    | 'join_duplicate_name'
    | 'join_full_room'
    | 'join_started_game',
    { status: number; body: any }
  >
}

/** GET /agents/catalog as the server answered it. */
export function wireCatalog(): Array<{
  id: string
  kind: 'bot' | 'llm' | 'scripted'
  label: string
  description: string
  available: boolean
}> {
  return structuredClone(raw.catalog)
}

/** Sentences the server sent when a player tried something it does not allow. */
export function wireRefusals(): string[] {
  return [...raw.refusals]
}

export function playedGame(ruleset: RulesetName): PlayedGame {
  return structuredClone(raw.games[ruleset]) as PlayedGame
}

export function rulesetOf(name: RulesetName): Ruleset {
  return ALL_RULESETS[name]
}

/** Make the player the seat in `state` and feed `messages` through the store, as the socket would. */
export function deliver(messages: Array<Record<string, any>>, playerId: string, isHost = false) {
  const store = useGameStore.getState()
  store.setRoomCode('TEST')
  store.setConnectionStatus('connected')
  store.setCurrentPlayer({ id: playerId, name: 'Alice', token: 'tok', isHost })
  for (const m of messages) useGameStore.getState().handleMessage(m)
}

/** Load a recorded snapshot as the human player sees it. */
export function loadSnapshotAsPlayer(name: SnapshotName) {
  const view = snapshot(name)
  deliver(view.player, view.human)
  return view
}

/** Make the server's ruleset the one in `name` (what GET /api/config/game returns). */
export function serverRuleset(name: RulesetName) {
  useRulesetStore.getState().setRuleset(ALL_RULESETS[name])
}
