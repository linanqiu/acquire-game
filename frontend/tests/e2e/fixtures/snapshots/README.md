# Snapshot fixtures

Game states that tier-3 screen tests load into the server (test-mode
`POST /test/room/{code}/load-snapshot`) instead of playing 20-40 turns through
the browser.

## The rule

**Generated only, never hand-edited.** Every file is produced by real play: a
recipe (`seed`, players `p1..pN`, and the full ordered list of wire-format
actions) is replayed from a fresh game through `apply_action`, and the result
is stored as `snapshot` together with an `expect` block (phase, pending
decisions with their `legal_actions`, the human's hand/cash/holdings, active
chains with sizes and prices). A state a user could not reach cannot be a
fixture.

`backend/tests/test_fixture_provenance.py` replays every recipe and compares
it with the stored snapshot, checks `expect`, checks the fixture's target
state, and (slow tier) regenerates everything and compares with these files.
An engine change that alters these states fails there until you regenerate on
purpose.

## Regenerate

```bash
cd backend && python -m fixtures_gen      # ~7s, deterministic, byte-identical reruns
cd backend && python -m pytest tests/test_fixture_provenance.py -q
```

`index.json` lists every fixture (name, description, human seat, phase,
decision kind). `criteria.missed` in a file or the index names ideal extras the
search did not manage to find; required criteria always hold.

The human seat is `p1` (name "Alice"). Load with a `seat_map` if the room's
player ids differ.
