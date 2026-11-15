import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AddAiControl } from './AddAiControl'
import { RemoveSeatButton } from './RemoveSeatButton'
import { SeatKindBadge } from './SeatKindBadge'
import { ToastProvider } from '../ui/ToastProvider'
import type { AgentCatalogEntry } from '../../types/api'
import { wireCatalog } from '../../../tests/unit/fixtures/wire'

// The catalog exactly as the server serves it (some LLM entries are not configured here).
const CATALOG: AgentCatalogEntry[] = wireCatalog()
const AVAILABLE_LLM = CATALOG.find((e) => e.kind === 'llm' && e.available)!
const UNAVAILABLE_LLM = CATALOG.find((e) => e.kind === 'llm' && !e.available)!

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>

function mockFetch(handler: FetchHandler) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderControl(props: Partial<React.ComponentProps<typeof AddAiControl>> = {}) {
  return render(
    <ToastProvider>
      <AddAiControl room="ABCD" {...props} />
    </ToastProvider>
  )
}

describe('AddAiControl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists catalog entries and shows unavailable ones disabled with a reason', async () => {
    mockFetch((url) =>
      url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({}, 404)
    )
    renderControl()

    fireEvent.click(await screen.findByTestId('add-ai-button'))

    expect(screen.getByTestId('ai-option-bot')).toBeEnabled()
    const ok = screen.getByTestId(`ai-option-${AVAILABLE_LLM.id}`)
    expect(ok).toHaveTextContent(AVAILABLE_LLM.label)
    expect(ok).toHaveTextContent(AVAILABLE_LLM.description)
    expect(ok).not.toHaveTextContent('not configured')
    const off = screen.getByTestId(`ai-option-${UNAVAILABLE_LLM.id}`)
    expect(off).toBeDisabled()
    expect(off).toHaveTextContent('not configured on this server')
  })

  it('posts add-seat with the chosen agent_id and closes the menu', async () => {
    const onAdded = vi.fn()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/agents/catalog') return jsonResponse(CATALOG)
      if (url === '/api/room/ABCD/add-seat')
        return jsonResponse({ player_id: 'p9', name: AVAILABLE_LLM.label, kind: 'llm' })
      return jsonResponse({}, 404)
    })
    renderControl({ onAdded })

    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId(`ai-option-${AVAILABLE_LLM.id}`))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('p9', AVAILABLE_LLM.label))
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/add-seat'))!
    expect(call[1]?.method).toBe('POST')
    expect(JSON.parse(String(call[1]?.body))).toEqual({ agent_id: AVAILABLE_LLM.id })
    expect(screen.queryByTestId('ai-menu')).not.toBeInTheDocument()
  })

  it('does not call add-seat for an unavailable entry', async () => {
    const fetchMock = mockFetch((url) =>
      url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({}, 404)
    )
    renderControl()
    fireEvent.click(await screen.findByTestId('add-ai-button'))
    fireEvent.click(screen.getByTestId(`ai-option-${UNAVAILABLE_LLM.id}`))
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('add-seat'))).toBe(false)
  })

  it('falls back to the plain add-bot button when the catalog 404s', async () => {
    const onAdded = vi.fn()
    const fetchMock = mockFetch((url) => {
      if (url === '/api/agents/catalog') return jsonResponse({ detail: 'Not Found' }, 404)
      if (url === '/api/room/ABCD/add-bot') return jsonResponse({ bot_id: 'bot-1' })
      return jsonResponse({}, 404)
    })
    renderControl({ onAdded })

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/agents/catalog')).toBe(true)
    )
    expect(screen.queryByTestId('add-ai-button')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ ADD BOT' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('bot-1', undefined))
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/room/ABCD/add-bot')).toBe(true)
  })

  it('falls back when the catalog request throws (network error)', async () => {
    mockFetch((url) =>
      url === '/api/agents/catalog' ? Promise.reject(new Error('offline')) : jsonResponse({})
    )
    renderControl()
    expect(await screen.findByRole('button', { name: '+ ADD BOT' })).toBeInTheDocument()
    expect(screen.queryByTestId('add-ai-button')).not.toBeInTheDocument()
  })

  it('disables everything when told to (lobby full)', async () => {
    mockFetch((url) => (url === '/api/agents/catalog' ? jsonResponse(CATALOG) : jsonResponse({})))
    renderControl({ disabled: true })
    expect(await screen.findByTestId('add-ai-button')).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ ADD BOT' })).toBeDisabled()
  })
})

describe('RemoveSeatButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts remove-seat for the given player', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    render(
      <ToastProvider>
        <RemoveSeatButton room="ABCD" playerId="bot-1" playerName="Botty" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByTestId('remove-seat-bot-1'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/room/ABCD/remove-seat/bot-1')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
  })

  it('stays usable after a failed removal', async () => {
    mockFetch(() => jsonResponse({ detail: 'nope' }, 400))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToastProvider>
        <RemoveSeatButton room="ABCD" playerId="bot-1" playerName="Botty" />
      </ToastProvider>
    )
    fireEvent.click(screen.getByTestId('remove-seat-bot-1'))
    await waitFor(() => expect(screen.getByTestId('remove-seat-bot-1')).toBeEnabled())
  })
})

describe('SeatKindBadge', () => {
  it('names the model in the badge (not next to the name) and distinguishes kinds', () => {
    render(
      <>
        <SeatKindBadge playerId="a" kind="llm" agentLabel="Claude" />
        <SeatKindBadge playerId="b" kind="bot" />
      </>
    )
    expect(screen.getByTestId('seat-kind-a')).toHaveAccessibleName('AI player, Claude')
    expect(screen.getByTestId('seat-kind-a')).toHaveAttribute('data-kind', 'llm')
    expect(screen.getByTestId('seat-kind-b')).toHaveAccessibleName('Rules-based bot')
    expect(screen.getByTestId('seat-kind-b')).toHaveAttribute('data-kind', 'bot')
  })
})
