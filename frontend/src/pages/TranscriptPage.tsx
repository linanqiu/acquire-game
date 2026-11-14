import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { Transcript } from '../types/transcripts'
import styles from './TranscriptPage.module.css'

const LIVE_POLL_MS = 5000
const SPEEDS = [1, 2, 4, 8]

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
  const last = replay.steps.length - 1
  const step = parseStep(params.get('step'), last)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [linkCopied, setLinkCopied] = useState(false)

  const names = useMemo(
    () => Object.fromEntries(transcript.header.seats.map((s) => [s.player_id, s.name])),
    [transcript]
  )

  const goTo = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(last, n))
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('step', String(clamped))
          return next
        },
        { replace: true }
      )
    },
    [last, setParams]
  )

  // Autoplay
  useEffect(() => {
    if (!playing) return
    if (step >= last) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlaying(false)
      return
    }
    const id = setTimeout(() => goTo(step + 1), 1200 / speed)
    return () => clearTimeout(id)
  }, [playing, step, last, speed, goTo])

  const togglePlay = useCallback(() => {
    if (!playing && step >= last) goTo(0)
    setPlaying((p) => !p)
  }, [playing, step, last, goTo])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          goTo(step + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          goTo(step - 1)
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
  }, [step, last, goTo, togglePlay])

  const current = replay.steps[step]
  const eventLines = useMemo(() => describeEvents(current.events, names), [current, names])
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
    <div className={styles.page} data-testid="transcript-viewer">
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
          {refreshError && <span className={styles.err}>Last refresh failed: {refreshError}</span>}
        </div>
      )}

      {last === 0 ? (
        <p className={styles.noMoves} data-testid="no-decisions">
          No decisions have been recorded for this game yet.
        </p>
      ) : null}

      <div className={styles.controls} role="group" aria-label="Replay controls">
        <button
          className={styles.ctl}
          onClick={() => goTo(0)}
          disabled={step === 0}
          aria-label="First step"
          data-testid="step-first"
        >
          ⏮
        </button>
        <button
          className={styles.ctl}
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
          aria-label="Previous step"
          data-testid="step-prev"
        >
          ◀
        </button>
        <button
          className={`${styles.ctl} ${styles.play}`}
          onClick={togglePlay}
          disabled={last === 0}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="play-pause"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className={styles.ctl}
          onClick={() => goTo(step + 1)}
          disabled={step >= last}
          aria-label="Next step"
          data-testid="step-next"
        >
          ▶▶
        </button>
        <button
          className={styles.ctl}
          onClick={() => goTo(last)}
          disabled={step >= last}
          aria-label="Last step"
          data-testid="step-last"
        >
          ⏭
        </button>
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={last}
          value={step}
          onChange={(e) => goTo(Number(e.target.value))}
          aria-label="Scrub through the game"
          data-testid="scrubber"
        />
        <span className={styles.counter} data-testid="step-counter">
          Step {step} / {last}
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
        <button className={styles.linkButton} onClick={copyLink} data-testid="copy-step-link">
          {linkCopied ? 'Link copied' : 'Copy link to this step'}
        </button>
      </div>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.aBoard}`} aria-label="Game state">
          <ReplayBoard
            state={current.state}
            seats={transcript.header.seats}
            highlightTile={placed}
            activePlayerId={current.decision?.player_id}
          />
        </section>

        <section
          className={`${styles.card} ${styles.aEvents}`}
          aria-label="What happened"
          data-testid="event-log"
        >
          <h3 className={styles.h3}>WHAT HAPPENED</h3>
          {eventLines.length === 0 ? (
            <p className={styles.muted}>No events recorded for this step.</p>
          ) : (
            <ul className={styles.events}>
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

        <div className={`${styles.timelineBox} ${styles.aTimeline}`}>
          <h3 className={styles.h3}>TIMELINE</h3>
          <div className={styles.timelineFrame}>
            <Timeline replay={replay} names={names} current={step} onSelect={goTo} />
          </div>
        </div>

        <div className={`${styles.aDecision}`}>
          <DecisionPanel
            step={current}
            totalSteps={last}
            seats={transcript.header.seats}
            names={names}
            systemPrompts={transcript.header.system_prompts ?? {}}
            redacted={transcript.redacted}
          />
          <p className={styles.hint}>
            Keyboard: ← → step, Space play/pause, Home / End jump to the start / end.
          </p>
        </div>
      </div>
    </div>
  )
}
