/**
 * Browser connectivity events for the WebSocket hooks.
 *
 * When a device loses its network, an open WebSocket usually does not close: no close
 * event arrives until TCP gives up, minutes later, so the page looked live while every
 * action was silently lost. The hooks therefore drop the socket on the browser's
 * `offline` event (showing the reconnection overlay) and reconnect on `online`.
 */

/** Detach a socket so that none of its handlers run any more, then close it. */
export function abandonSocket(ws: WebSocket): void {
  ws.onopen = null
  ws.onmessage = null
  ws.onerror = null
  ws.onclose = null
  try {
    ws.close()
  } catch {
    // Already closing/closed: nothing to do.
  }
}

/** Subscribe to offline/online; returns the unsubscribe function. */
export function watchNetwork(onOffline: () => void, onOnline: () => void): () => void {
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)
  return () => {
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  }
}
