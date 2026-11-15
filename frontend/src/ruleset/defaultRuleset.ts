/**
 * The default ruleset, used ONLY as a fallback: before the server's configuration has loaded in
 * unit tests, and for transcripts whose header carries no ruleset. The running app always shows
 * the server's ruleset (`GET /api/config/game`) or the game's own (`game_state.ruleset`).
 *
 * Mirrors backend/rulesets/default.json (a unit test keeps the two identical).
 */
import type { Ruleset } from '../types/ruleset'

export const DEFAULT_RULESET: Ruleset = {
  id: 'default',
  version: 1,
  title: 'Grand Hotels',
  theme: {
    chain_noun: 'hotel chain',
    chain_noun_plural: 'hotel chains',
    share_noun: 'share',
    share_noun_plural: 'shares',
    stock_label: 'Stocks',
    merger_noun: 'merger',
    merger_noun_plural: 'mergers',
    safe_phrase: 'safe',
    currency_symbol: '$',
    tagline: 'Found hotel chains, buy stock, merge for profit.',
    game_description: 'a board game about founding and merging hotel chains',
  },
  board: {
    columns: 12,
    rows: 9,
  },
  tiers: [
    {
      id: 'cheap',
      label: 'cheap',
      prices: [
        {
          from: 2,
          price: 200,
        },
        {
          from: 3,
          price: 300,
        },
        {
          from: 4,
          price: 400,
        },
        {
          from: 5,
          price: 500,
        },
        {
          from: 6,
          price: 600,
        },
        {
          from: 11,
          price: 700,
        },
        {
          from: 21,
          price: 800,
        },
        {
          from: 31,
          price: 900,
        },
        {
          from: 41,
          price: 1000,
        },
      ],
    },
    {
      id: 'medium',
      label: 'medium',
      prices: [
        {
          from: 2,
          price: 300,
        },
        {
          from: 3,
          price: 400,
        },
        {
          from: 4,
          price: 500,
        },
        {
          from: 5,
          price: 600,
        },
        {
          from: 6,
          price: 700,
        },
        {
          from: 11,
          price: 800,
        },
        {
          from: 21,
          price: 900,
        },
        {
          from: 31,
          price: 1000,
        },
        {
          from: 41,
          price: 1100,
        },
      ],
    },
    {
      id: 'expensive',
      label: 'expensive',
      prices: [
        {
          from: 2,
          price: 400,
        },
        {
          from: 3,
          price: 500,
        },
        {
          from: 4,
          price: 600,
        },
        {
          from: 5,
          price: 700,
        },
        {
          from: 6,
          price: 800,
        },
        {
          from: 11,
          price: 900,
        },
        {
          from: 21,
          price: 1000,
        },
        {
          from: 31,
          price: 1100,
        },
        {
          from: 41,
          price: 1200,
        },
      ],
    },
  ],
  chains: [
    {
      id: 'sandpiper',
      name: 'Sandpiper',
      tier: 'cheap',
      color: '#E3B448',
      abbreviation: 'SP',
    },
    {
      id: 'marlowe',
      name: 'Marlowe',
      tier: 'cheap',
      color: '#8E2C48',
      abbreviation: 'MA',
    },
    {
      id: 'halcyon',
      name: 'Halcyon',
      tier: 'medium',
      color: '#1F7A8C',
      abbreviation: 'HA',
    },
    {
      id: 'meridian',
      name: 'Meridian',
      tier: 'medium',
      color: '#E07A3F',
      abbreviation: 'ME',
    },
    {
      id: 'juniper',
      name: 'Juniper',
      tier: 'medium',
      color: '#3E7C4A',
      abbreviation: 'JU',
    },
    {
      id: 'obsidian',
      name: 'Obsidian',
      tier: 'expensive',
      color: '#3F5BD9',
      abbreviation: 'OB',
    },
    {
      id: 'aurelia',
      name: 'Aurelia',
      tier: 'expensive',
      color: '#B48CDB',
      abbreviation: 'AU',
    },
  ],
  bonuses: {
    majority_multiplier: 10,
    minority_multiplier: 5,
    tie_round_up_to: 100,
  },
  stocks_per_chain: 25,
  starting_cash: 6000,
  hand_size: 6,
  max_stock_purchases_per_turn: 3,
  safe_chain_size: 11,
  end_game_chain_size: 41,
  founder_bonus_shares: 1,
  merger_trade_ratio: 2,
  min_players: 3,
  max_players: 6,
  max_pending_trades_per_player: 5,
}
