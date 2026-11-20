import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  useLayoutEffect,
} from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { PageFrame, LoadingView, ErrorView } from '../components/transcripts/PageFrame'
import { SummaryHeader } from '../components/transcripts/SummaryHeader'
import { ReplayBoard } from '../components/transcripts/ReplayBoard'
import { Timeline } from '../components/transcripts/Timeline'
import { DecisionPanel } from '../components/transcripts/DecisionPanel'
import { useFetch } from '../hooks/useFetch'
import { fetchTranscript } from '../lib/transcripts'
import { buildReplay, parseStep } from '../lib/replay'
import { describeEvents } from '../lib/eventText'
import type { PublicState, Transcript } from '../types/transcripts'
import { RulesetScope } from '../ruleset/RulesetScope'
import { rulesetForTranscript } from '../lib/ruleset'
import { useServerRuleset } from '../ruleset/useRules'
import styles from './TranscriptPage.module.css'

const LIVE_POLL_MS = 5000
const SPEEDS = [1, 2, 4, 8]
/**
 * The step is written to the address (?step=, for links) at most this often. Dragging the
 * scrubber or playing used to write it on every step; Safari refuses more than 100 history
 * writes in 10 seconds (a SecurityError), and as the step was read back from the address the
 * scrubber then stopped following the finger: it "jammed up after a while" (BL-019).
 */
const URL_WRITE_MS = 400

export function TranscriptPage() {
  const { gameId = '' } = useParams()
  // Remount per game so no state (step, playing) leaks between transcripts.
  return <TranscriptLoader key={gameId} gameId={gameId} />
}

function TranscriptLoader({ gameId }: { gameId: string }) {
  const { data, error, loading, reload } = useFetch(
    (signal) => fetchTranscript(gameId, signal),
    `transcript:${gameId}`
  )
  const live = !!data && (data.redacted || !data.footer)

  useEffect(() => {
    if (!live || data?.footer) return
    const id = setInterval(reload, LIVE_POLL_MS)
    return () => clearInterval(id)
  }, [live, data?.footer, reload])

  return (
    <PageFrame>
      {loading && !data && !error && <LoadingView label="Loading transcript" />}
      {error && !data && <ErrorView error={error} what="game" byId onRetry={reload} />}
      {data && <Viewer transcript={data} onRefresh={reload} refreshError={error?.message} />}
    </PageFrame>
  )
}

function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT' ||
    t.isContentEditable
  )
}

function Viewer({
  transcript,
  onRefresh,
  refreshError,
}: {
  transcript: Transcript
  onRefresh: () => void
  refreshError?: string
}) {
  const [params, setParams] = useSearchParams()
  const replay = useMemo(() => buildReplay(transcript), [transcript])
  // The transcript's own ruleset (it may differ from this server's current one).
  const serverRuleset = useServerRuleset()
  const ruleset = useMemo(
    () =>
      rulesetForTranscript(
        transcript.header.ruleset,
        replay.steps.map((s) => s.state).filter((s): s is PublicState => !!s),
        [serverRuleset]
      ),
    [transcript, replay, serverRuleset]
  )
  const last = replay.steps.length - 1
  // The step lives in the page; the address follows it, throttled (see URL_WRITE_MS).
  const urlStep = params.get('step')
  const [step, setStep] = useState(() => parseStep(urlStep, last))
  const written = useRef<string | null>(urlStep)
  // The address changed by something else (a link to another step): follow it.
  useEffect(() => {
    if (urlStep === written.current) return
    written.current = urlStep
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is the input here
    setStep(parseStep(urlStep, last))
  }, [urlStep, last])
  // A live transcript grows: keep the step inside it.
  const shown = Math.min(step, last)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [linkCopied, setLinkCopied] = useState(false)

  const names = useMemo(
    () => Object.fromEntries(transcript.header.seats.map((s) => [s.player_id, s.name])),
    [transcript]
  )

  const goTo = useCallback((n: number) => setStep(Math.max(0, Math.min(last, n))), [last])
  // One step from where the page is now (the state, not a render's copy of it): two quick key
  // presses before the listener is re-attached must still move two steps.
  const stepBy = useCallback(
    (delta: number) => setStep((s) => Math.max(0, Math.min(last, Math.min(s, last) + delta))),
    [last]
  )

  // Write the step to the address, at most once per URL_WRITE_MS, and always the last one.
  const lastWrite = useRef(0)
  useEffect(() => {
    const value = String(shown)
    if (written.current === value || (written.current === null && shown === 0)) return
    const write = () => {
      written.current = value
      lastWrite.current = Date.now()
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('step', value)
          return next
        },
        { replace: true }
      )
    }
    const wait = URL_WRITE_MS - (Date.now() - lastWrite.current)
    if (wait <= 0) {
      write()
      return
    }
    const id = setTimeout(write, wait)
    return () => clearTimeout(id)
  }, [shown, setParams])

  // Autoplay
  useEffect(() => {
    if (!playing) return
    if (shown >= last) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlaying(false)
      return
    }
    const id = setTimeout(() => goTo(shown + 1), 1200 / speed)
    return () => clearTimeout(id)
  }, [playing, shown, last, speed, goTo])

  const togglePlay = useCallback(() => {
    if (!playing && shown >= last) goTo(0)
    setPlaying((p) => !p)
  }, [playing, shown, last, goTo])

  // Keyboard. A layout effect: the keys work from the first frame the replay is on screen
  // (a passive effect could attach after paint, and early presses were lost).
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          stepBy(1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          stepBy(-1)
          break
        case 'Home':
          e.preventDefault()
          goTo(0)
          break
        case 'End':
          e.preventDefault()
          goTo(last)
          break
        case ' ':
          if (
            e.target instanceof HTMLElement &&
            ['BUTTON', 'A', 'SUMMARY'].includes(e.target.tagName)
          )
            return
          e.preventDefault()
          togglePlay()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, goTo, stepBy, togglePlay])

  const current = replay.steps[shown]
  const eventLines = useMemo(
    () => describeEvents(current.events, names, ruleset),
    [current, names, ruleset]
  )
  const placed = current.events.find((e) => e.type === 'tile_placed')?.tile as string | undefined
  const live = !transcript.footer
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      setLinkCopied(false)
    }
  }

  return (
    <RulesetScope ruleset={ruleset}>
      <div
        className={styles.page}
        data-testid="transcript-viewer"
        data-ruleset={ruleset.id}
        data-board={`${ruleset.board.columns}x${ruleset.board.rows}`}
      >
        <SummaryHeader transcript={transcript} replay={replay} />

        {live && (
          <div className={styles.liveBar} data-testid="live-bar">
            <span>
              <span className={styles.dot} aria-hidden="true" /> Live. This page refreshes every{' '}
              {LIVE_POLL_MS / 1000} seconds.
            </span>
            <button
              className={styles.linkButton}
              onClick={onRefresh}
              data-testid="refresh-transcript"
            >
              Refresh now
            </button>
            {refreshError && (
              <span className={styles.err}>Last refresh failed: {refreshError}</span>
            )}
          </div>
        )}

        {last === 0 ? (
          <p className={styles.noMoves} data-testid="no-decisions">
            No decisions have been recorded for this game yet.
          </p>
        ) : null}

        <div className={styles.controls} role="group" aria-label="Replay controls">
          <div className={styles.buttons}>
            <button
              className={styles.ctl}
              onClick={() => goTo(0)}
              disabled={shown === 0}
              aria-label="First step"
              title="First step (Home)"
              data-testid="step-first"
            >
              <Icon d="M6 5v14M18 6l-8 6 8 6z" />
            </button>
            <button
              className={styles.ctl}
              onClick={() => stepBy(-1)}
              disabled={shown === 0}
              aria-label="Previous step"
              title="Previous step (←)"
              data-testid="step-prev"
            >
              <Icon d="M15 6l-6 6 6 6" />
            </button>
            <button
              className={`${styles.ctl} ${styles.play}`}
              onClick={togglePlay}
              disabled={last === 0}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause (Space)' : 'Play (Space)'}
              data-testid="play-pause"
            >
              {playing ? <Icon d="M8 5v14M16 5v14" /> : <Icon d="M8 5l11 7-11 7z" fill />}
            </button>
            <button
              className={styles.ctl}
              onClick={() => stepBy(1)}
              disabled={shown >= last}
              aria-label="Next step"
              title="Next step (→)"
              data-testid="step-next"
            >
              <Icon d="M9 6l6 6-6 6" />
            </button>
            <button
              className={styles.ctl}
              onClick={() => goTo(last)}
              disabled={shown >= last}
              aria-label="Last step"
              title="Last step (End)"
              data-testid="step-last"
            >
              <Icon d="M18 5v14M6 6l8 6-8 6z" />
            </button>
            <span className={styles.counter} data-testid="step-counter">
              {/* The word is for screen readers: on a phone the numbers are all the row has room for. */}
              <span className={styles.srOnly}>Step </span>
              {shown} / {last}
            </span>
            <label className={styles.speed}>
              <span className={styles.srOnly}>Playback speed</span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                data-testid="speed"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </label>
            <button
              className={styles.ctl}
              onClick={copyLink}
              aria-label={linkCopied ? 'Link copied' : 'Copy link to this step'}
              title={linkCopied ? 'Link copied' : 'Copy link to this step'}
              data-testid="copy-step-link"
            >
              {linkCopied ? (
                <Icon d="M5 12l5 5 9-10" />
              ) : (
                <Icon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
              )}
            </button>
          </div>
          <input
            className={styles.scrub}
            type="range"
            min={0}
            max={last}
            value={shown}
            onChange={(e) => goTo(Number(e.target.value))}
            aria-label="Scrub through the game"
            data-testid="scrubber"
          />
        </div>

        <div className={styles.grid}>
          <section className={styles.aBoard} aria-label="Game state">
            <ReplayBoard
              state={current.state}
              seats={transcript.header.seats}
              highlightTile={placed}
              activePlayerId={current.decision?.player_id}
              afterBoard={
                <section
                  className={styles.events}
                  aria-label="What happened"
                  data-testid="event-log"
                >
                  {eventLines.length === 0 ? (
                    <p className={styles.muted}>No events recorded for this step.</p>
                  ) : (
                    <ul className={styles.eventList}>
                      {eventLines.map((l) => (
                        <li
                          key={l.key}
                          className={l.isPrivate ? styles.private : ''}
                          data-event-type={l.type}
                        >
                          {l.text}
                          {l.isPrivate && <span className={styles.lock}> (private)</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              }
            />
          </section>

          <div className={styles.aDecision}>
            <DecisionPanel
              step={current}
              totalSteps={last}
              seats={transcript.header.seats}
              names={names}
              systemPrompts={transcript.header.system_prompts ?? {}}
              redacted={transcript.redacted}
            />
          </div>

          <section className={styles.aTimeline} aria-label="Timeline">
            <h3 className={styles.h3}>TIMELINE</h3>
            <Timeline replay={replay} names={names} current={shown} onSelect={goTo} />
            <p className={styles.hint}>
              Keyboard: ← → step, Space play/pause, Home / End jump to the start / end.
            </p>
          </section>
        </div>
      </div>
    </RulesetScope>
  )
}

/** A replay control's icon: one stroke path on a 24px grid (no emoji glyphs). */
function Icon({ d, fill = false }: { d: string; fill?: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={d}
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
