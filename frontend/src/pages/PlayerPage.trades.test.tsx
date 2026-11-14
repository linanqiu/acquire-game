/**
 * Trading and reconnection on the player page, from real server states (recorded from the
 * backend, tests/unit/fixtures/generate_wire_messages.py). Answering an offer is in
 * PlayerPage.screens.test.tsx; here: what the offers panel says, the notices, the builder
 * round trip, and the connection overlay.
 */
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import { loadSnapshotAsPlayer, snapshot } from '../../tests/unit/fixtures/wire'

const ws = vi.hoisted(() => ({
  sendAction: vi.fn(() => true),
  reconnect: vi.fn(() => Promise.resolve(true)),
  onError: undefined as undefined | ((e: string) => void),
}))

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: (opts: { onError?: (e: string) => void }) => {
    ws.onError = opts.onError
    return {
      sendAction: ws.sendAction,
      reconnect: ws.reconnect,
      disconnect: vi.fn(),
      isConnected: true,
    }
  },
}))

function mount() {
  return render(
    <MemoryRouter initialEntries={['/play/TEST']}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

const deliver = (msg: Record<string, unknown>) =>
  act(() => useGameStore.getState().handleMessage(msg as never))
const stateOf = (view: ReturnType<typeof snapshot>) =>
  view.player.find((m) => m.type === 'game_state')!

beforeEach(() => {
  ws.sendAction.mockClear()
  ws.sendAction.mockReturnValue(true)
  useGameStore.getState().reset()
})

describe('the offers panel', () => {
  it('shows an incoming offer with who sent it (and that it is an AI seat), what they give and what they ask', () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    mount()
    const [offer] = stateOf(view).incoming_trades
    const proposer = stateOf(view).players[offer.from_player_id]
    const card = screen.getByTestId(`trade-offer-${offer.trade_id}`)
    expect(within(card).getByText(proposer.name)).toBeInTheDocument()
    expect(within(card).getByTestId(`seat-kind-${offer.from_player_id}`)).toBeInTheDocument()
    const [chain, qty] = Object.entries(offer.offering_stocks)[0] as [string, number]
    expect(within(card).getByTestId(`trade-stock-${chain}`)).toHaveTextContent(`×${qty}`)
    expect(card).toHaveTextContent(`$${offer.requesting_money.toLocaleString('en-US')}`)
  })

  it('shows my own pending offer with the person it went to', () => {
    const view = loadSnapshotAsPlayer('trade-outgoing-pending')
    mount()
    const [offer] = stateOf(view).outgoing_trades
    const to = stateOf(view).players[offer.to_player_id]
    expect(screen.getByTestId(`trade-outgoing-${offer.trade_id}`)).toHaveTextContent(to.name)
  })

  it('Accept is off, with the reason, when I cannot give what is asked; Reject still works', () => {
    const view = snapshot('trade-incoming')
    const state = stateOf(view)
    const me = state.players[view.human]
    const [offer] = state.incoming_trades
    offer.requesting_money = me.money + 1
    useGameStore.getState().reset()
    // deliver the doctored copy of the real state
    useGameStore.getState().setRoomCode('TEST')
    useGameStore.getState().setConnectionStatus('connected')
    useGameStore
      .getState()
      .setCurrentPlayer({ id: view.human, name: 'Alice', token: 't', isHost: false })
    useGameStore.getState().handleMessage(state)
    mount()
    expect(screen.getByTestId(`trade-accept-${offer.trade_id}`)).toBeDisabled()
    expect(screen.getByTestId(`trade-reason-${offer.trade_id}`)).toHaveTextContent(
      "You can't afford"
    )
    expect(screen.getByTestId(`trade-reject-${offer.trade_id}`)).toBeEnabled()
  })

  it.each(['disposition-human-first', 'found-chain-choice'])(
    'an offer that arrives while I answer a prompt (%s) is still shown',
    (name) => {
      const view = loadSnapshotAsPlayer(name)
      mount()
      const other = Object.keys(stateOf(view).players).find((id) => id !== view.human)!
      deliver({
        type: 'trade_proposed',
        trade: {
          trade_id: 'late',
          from_player_id: other,
          to_player_id: view.human,
          offering_stocks: {},
          offering_money: 100,
          requesting_stocks: {},
          requesting_money: 0,
        },
      })
      expect(screen.getByTestId('trade-offer-late')).toBeInTheDocument()
    }
  )
})

describe('trade notices', () => {
  it('tells me when an offer arrives, and when one of mine is accepted or rejected', () => {
    const view = loadSnapshotAsPlayer('trade-outgoing-pending')
    mount()
    const state = stateOf(view)
    const [mine] = state.outgoing_trades
    const to = state.players[mine.to_player_id].name
    // an offer for me from the same player
    deliver({
      type: 'trade_proposed',
      trade: {
        ...mine,
        trade_id: 'in-1',
        from_player_id: mine.to_player_id,
        to_player_id: view.human,
      },
    })
    expect(screen.getByText(`${to} sent you a trade offer`)).toBeInTheDocument()
    deliver({
      type: 'trade_accepted',
      trade_id: mine.trade_id,
      from_player: view.human,
      to_player: mine.to_player_id,
    })
    expect(screen.getByText(`${to} accepted your offer`)).toBeInTheDocument()
    expect(screen.queryByTestId(`trade-outgoing-${mine.trade_id}`)).not.toBeInTheDocument()
    deliver({ type: 'trade_proposed', trade: { ...mine, trade_id: 'out-2' } })
    deliver({ type: 'trade_rejected', trade_id: 'out-2', rejected_by: mine.to_player_id })
    expect(screen.getByText(`${to} rejected your offer`)).toBeInTheDocument()
  })
})

describe('trade notices for offers made to me', () => {
  const setup = () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    mount()
    const [offer] = stateOf(view).incoming_trades
    const from = stateOf(view).players[offer.from_player_id].name
    return { view, offer, from }
  }

  it('when I accept, the page says the trade with the proposer is completed', () => {
    const { view, offer, from } = setup()
    deliver({
      type: 'trade_accepted',
      trade_id: offer.trade_id,
      from_player: offer.from_player_id,
      to_player: view.human,
    })
    expect(screen.getByText(`Trade with ${from} completed`)).toBeInTheDocument()
    expect(screen.queryByTestId(`trade-offer-${offer.trade_id}`)).not.toBeInTheDocument()
  })

  it('when I reject, it says "Offer rejected"; when the proposer withdraws, it names them', () => {
    const { view, offer, from } = setup()
    deliver({ type: 'trade_rejected', trade_id: offer.trade_id, rejected_by: view.human })
    expect(screen.getByText('Offer rejected')).toBeInTheDocument()
    deliver({ type: 'trade_proposed', trade: { ...offer, trade_id: 'second' } })
    deliver({ type: 'trade_canceled', trade_id: 'second', canceled_by: offer.from_player_id })
    expect(screen.getByText(`${from} withdrew their offer`)).toBeInTheDocument()
  })

  it('when I cancel an offer of mine, it says "Offer canceled"', () => {
    const view = loadSnapshotAsPlayer('trade-outgoing-pending')
    mount()
    const [mine] = stateOf(view).outgoing_trades
    deliver({ type: 'trade_canceled', trade_id: mine.trade_id, canceled_by: view.human })
    expect(screen.getByText('Offer canceled')).toBeInTheDocument()
  })

  it('news about a trade between two other players is not announced to me', () => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    mount()
    const [a, b] = Object.keys(stateOf(view).players).filter((id) => id !== view.human)
    deliver({
      type: 'trade_proposed',
      trade: {
        trade_id: 'other',
        from_player_id: a,
        to_player_id: b,
        offering_stocks: {},
        offering_money: 1,
        requesting_stocks: {},
        requesting_money: 0,
      },
    })
    expect(screen.queryByText(/sent you a trade offer/)).not.toBeInTheDocument()
  })
})

describe('proposing a trade', () => {
  const open = () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'PROPOSE TRADE' }))
    const state = stateOf(view)
    const partner = Object.entries(state.players).find(([id]) => id !== view.human)!
    fireEvent.click(screen.getByTestId(`player-select-${partner[0]}`))
    fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: '100' } })
    fireEvent.change(screen.getByTestId('want-cash-input'), { target: { value: '50' } })
    fireEvent.click(screen.getByTestId('propose-trade'))
    return { partner: partner[0], view }
  }

  it('sends the proposal; a server refusal shows inside the builder, which stays open', () => {
    const { partner } = open()
    expect(ws.sendAction).toHaveBeenLastCalledWith({
      action: 'propose_trade',
      to_player_id: partner,
      offering_stocks: {},
      offering_money: 100,
      requesting_stocks: {},
      requesting_money: 50,
    })
    act(() => ws.onError?.('Maximum of 5 pending trades per player'))
    expect(screen.getByTestId('trade-error')).toHaveTextContent('Maximum of 5 pending trades')
    expect(screen.getByTestId('trade-builder')).toBeInTheDocument()
  })

  it('the builder closes once the server confirms the proposal (trade_proposed)', () => {
    const { partner, view } = open()
    deliver({
      type: 'trade_proposed',
      trade: {
        trade_id: 'new',
        from_player_id: view.human,
        to_player_id: partner,
        offering_stocks: {},
        offering_money: 100,
        requesting_stocks: {},
        requesting_money: 50,
      },
    })
    expect(screen.queryByTestId('trade-builder')).not.toBeInTheDocument()
    expect(screen.getByTestId('trade-outgoing-new')).toBeInTheDocument()
  })

  it('during a merger the builder warns that the shares involved cannot be traded', () => {
    loadSnapshotAsPlayer('disposition-human-first')
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'PROPOSE TRADE' }))
    expect(screen.getByTestId('trade-builder')).toHaveTextContent(/merger is in progress/)
  })
})

describe('reconnection', () => {
  it('overlays the game when the socket drops, and welcomes the player back when it returns', () => {
    loadSnapshotAsPlayer('trade-incoming')
    mount()
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
    act(() => useGameStore.setState({ connectionStatus: 'connecting' }))
    expect(screen.getByText('RECONNECTING...')).toBeInTheDocument()
    // the game stays rendered underneath instead of collapsing into a spinner
    expect(screen.getByTestId('trade-offers')).toBeInTheDocument()
    act(() => useGameStore.setState({ connectionStatus: 'connected' }))
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
    expect(screen.getByTestId('reconnected-toast')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('continue-playing'))
    expect(screen.queryByTestId('reconnected-toast')).not.toBeInTheDocument()
  })

  it('shows no overlay and no welcome during the first connection', () => {
    useGameStore.setState({ connectionStatus: 'connecting' })
    mount()
    expect(screen.queryByText('RECONNECTING...')).not.toBeInTheDocument()
    expect(screen.getByText('Connecting to game...')).toBeInTheDocument()
    act(() => useGameStore.setState({ connectionStatus: 'connected' }))
    expect(screen.queryByTestId('reconnected-toast')).not.toBeInTheDocument()
  })
})
