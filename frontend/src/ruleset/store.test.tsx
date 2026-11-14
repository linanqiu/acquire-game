/**
 * Loading the server's ruleset before the app shows anything. The body served is the ruleset
 * exactly as a real game_state carries it (recorded from the backend).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { isRuleset, useRulesetStore } from './store'
import { RulesetGate } from './RulesetGate'
import { playedGame } from '../../tests/unit/fixtures/wire'

const served = (name: 'classic' | 'valley' | 'mini') =>
  playedGame(name).states['place_tile/place_tile'].ruleset

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function serve(...answers: Array<() => Response | Promise<Response>>) {
  const fn = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    return next()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  useRulesetStore.setState({ ruleset: null, status: 'idle', error: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.title = ''
})

describe('isRuleset', () => {
  it('accepts every real ruleset, and rejects anything missing a part the app needs', () => {
    for (const name of ['classic', 'valley', 'mini'] as const)
      expect(isRuleset(served(name))).toBe(true)
    const ok = served('classic')
    for (const broken of [
      null,
      'classic',
      {},
      { ...ok, title: 3 },
      { ...ok, theme: undefined },
      { ...ok, board: undefined },
      { ...ok, board: { columns: '12', rows: 9 } },
      { ...ok, board: { columns: 12, rows: '9' } },
      { ...ok, chains: {} },
      { ...ok, tiers: undefined },
    ]) {
      expect(isRuleset(broken), JSON.stringify(broken)?.slice(0, 40)).toBe(false)
    }
  })
})

describe('loading the ruleset', () => {
  it('asks /api/config/game once, and the app has the ruleset the server sent', async () => {
    const fetchMock = serve(() => json(served('mini')))
    await useRulesetStore.getState().load()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/config/game')
    expect(useRulesetStore.getState()).toMatchObject({ status: 'ready', error: null })
    expect(useRulesetStore.getState().ruleset?.title).toBe('Harborline')
    await useRulesetStore.getState().load()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('force loads again (a changed server configuration)', async () => {
    const fetchMock = serve(
      () => json(served('classic')),
      () => json(served('valley'))
    )
    await useRulesetStore.getState().load()
    await useRulesetStore.getState().load({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useRulesetStore.getState().ruleset?.title).toBe('Acquihire')
  })

  it('a second request while the first is in flight does not start another', async () => {
    let release: (r: Response) => void = () => {}
    const fetchMock = serve(() => new Promise<Response>((r) => (release = r)))
    const a = useRulesetStore.getState().load()
    expect(useRulesetStore.getState().status).toBe('loading')
    const b = useRulesetStore.getState().load()
    release(json(served('classic')))
    await Promise.all([a, b])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an HTTP error says what the server answered; a bad body says it was unexpected', async () => {
    serve(() => json({ detail: 'nope' }, 404))
    await useRulesetStore.getState().load()
    expect(useRulesetStore.getState()).toMatchObject({
      status: 'error',
      error: 'The server answered 404',
    })
    serve(() => json({ hello: 'world' }))
    await useRulesetStore.getState().load()
    expect(useRulesetStore.getState().error).toBe(
      'The server sent an unexpected game configuration'
    )
    expect(useRulesetStore.getState().ruleset).toBeNull()
  })

  it('a network failure is an error with its message; a non-Error failure gets a generic one', async () => {
    vi.useFakeTimers()
    serve(() => {
      throw new TypeError('Failed to fetch')
    })
    const done = useRulesetStore.getState().load()
    await vi.runAllTimersAsync()
    await done
    expect(useRulesetStore.getState().error).toBe('Failed to fetch')
    serve(() => Promise.reject('plain string'))
    const again = useRulesetStore.getState().load({ force: true })
    await vi.runAllTimersAsync()
    await again
    expect(useRulesetStore.getState().error).toBe('Could not load the game configuration')
  })

  it('setRuleset(null) goes back to idle', () => {
    useRulesetStore.getState().setRuleset(served('classic'))
    expect(useRulesetStore.getState().status).toBe('ready')
    useRulesetStore.getState().setRuleset(null)
    expect(useRulesetStore.getState()).toMatchObject({ ruleset: null, status: 'idle' })
  })
})

describe('RulesetGate', () => {
  const mount = () =>
    render(
      <RulesetGate>
        <p>the app</p>
      </RulesetGate>
    )

  it('shows a loading note, then the app, and puts the game title on the browser tab', async () => {
    serve(() => json(served('valley')))
    mount()
    expect(screen.getByTestId('ruleset-loading')).toHaveTextContent('Loading…')
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
    expect(await screen.findByText('the app')).toBeInTheDocument()
    expect(document.title).toBe('Acquihire')
  })

  it('says the server is waking up while the first requests are being retried', async () => {
    vi.useFakeTimers()
    serve(
      () => new Response('', { status: 503 }),
      () => json(served('classic'))
    )
    mount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(screen.getByTestId('ruleset-loading')).toHaveTextContent('Waking the server')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByText('the app')).toBeInTheDocument()
  })

  it('on failure offers TRY AGAIN, which asks again and shows the app when the server answers', async () => {
    const fetchMock = serve(
      () => json({}, 404),
      () => json(served('classic'))
    )
    mount()
    expect(await screen.findByTestId('ruleset-error')).toHaveTextContent('The server answered 404')
    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the game server")
    fireEvent.click(screen.getByTestId('ruleset-retry'))
    await waitFor(() => expect(screen.getByText('the app')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
