/**
 * Table chat in the replay: `chat` lines belong to the step whose decision they followed
 * (lobby chat to step 0); `chat_reply` lines (talk-call accounting) are not steps.
 */
import { describe, it, expect } from 'vitest'
import { buildReplay } from './replay'
import full from '../../tests/unit/fixtures/transcript-full.json'
import type { ChatEntry, Transcript, TranscriptEntry } from '../types/transcripts'

const base = full as unknown as Transcript

function chat(id: number, text: string, after_seq: number): ChatEntry {
  return {
    type: 'chat',
    id,
    player_id: 'x',
    name: 'Alice',
    kind: 'human',
    source: 'human',
    text,
    at: '2026-11-15T10:00:00Z',
    after_seq,
    reply_to: null,
    decision_index: null,
  }
}

describe('buildReplay with table chat', () => {
  it('puts chat on the step it followed and leaves the steps unchanged', () => {
    const entries = [...base.entries] as TranscriptEntry[]
    const firstDecision = entries.findIndex((e) => e.type === 'decision')
    const secondDecision = entries.findIndex((e, i) => i > firstDecision && e.type === 'decision')
    entries.splice(secondDecision, 0, chat(2, 'after the first move', 5), {
      type: 'chat_reply',
      after_seq: 5,
      player_id: 'x',
      trigger: { source: 'human', message_id: 2, events: [] },
      reply_to: 2,
      outcome: 'silent',
      message_id: null,
      latency_s: 0.1,
      llm: null,
    })
    entries.splice(1, 0, chat(1, 'good luck', -1))
    const withChat = buildReplay({ ...base, entries })
    const without = buildReplay(base)
    expect(withChat.steps).toHaveLength(without.steps.length)
    expect(withChat.steps[0].chat.map((c) => c.text)).toEqual(['good luck'])
    expect(withChat.steps[1].chat.map((c) => c.text)).toEqual(['after the first move'])
    expect(withChat.steps.slice(2).every((s) => s.chat.length === 0)).toBe(true)
    expect(withChat.steps[1].events).toEqual(without.steps[1].events)
  })
})
