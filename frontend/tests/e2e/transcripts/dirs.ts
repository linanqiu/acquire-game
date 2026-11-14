import * as os from 'os'
import * as path from 'path'

/**
 * Directories shared by playwright.config.ts (which starts the backend with them) and the
 * transcripts spec (which runs the standalone benchmark into BENCH_DIR before the test).
 * Outside the source tree and outside Playwright's own `test-results/` (which it wipes).
 */
const ROOT = process.env.ACQUIRE_E2E_DIR ?? path.join(os.tmpdir(), 'acquire-e2e')

/** `ACQUIRE_BENCH_DIR` of the backend: a parent of results directories (`run1/`). */
export const BENCH_DIR = path.join(ROOT, 'bench')
/** The one results directory the spec writes (`python -m bench run --out ...`). */
export const BENCH_RUN_DIR = path.join(BENCH_DIR, 'run1')
/** `ACQUIRE_TRANSCRIPT_DIR` of the backend: transcripts of live games. */
export const TRANSCRIPT_DIR = path.join(ROOT, 'transcripts')
