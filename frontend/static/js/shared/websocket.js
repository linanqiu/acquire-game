/**
 * Reusable WebSocket client with reconnection and heartbeat support
 */

import { CONFIG } from './constants.js';

/**
 * Create a WebSocket connection manager
 * @param {Object} options - Configuration options
 * @param {string} options.url - WebSocket URL to connect to
 * @param {Object} options.handlers - Message type handlers {type: function(message)}
 * @param {function} [options.onConnect] - Called when connected
 * @param {function} [options.onDisconnect] - Called when disconnected
 * @param {function} [options.onError] - Called on error
 * @returns {Object} WebSocket manager with connect, send, close methods
 */
export function createSocket(options) {
    const {
        url,
        handlers = {},
        onConnect,
        onDisconnect,
        onError
    } = options;

    let ws = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let isClosing = false;

    /**
     * Connect to the WebSocket server
     */
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            return;
        }

        isClosing = false;

        try {
            ws = new WebSocket(url);
            ws.onopen = handleOpen;
            ws.onclose = handleClose;
            ws.onerror = handleError;
            ws.onmessage = handleMessage;
        } catch (error) {
            console.error('WebSocket connection error:', error);
            if (onError) onError(error);
            scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket open event
     */
    function handleOpen() {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        startHeartbeat();
        if (onConnect) onConnect();
    }

    /**
     * Handle WebSocket close event
     */
    function handleClose(event) {
        console.log('WebSocket closed:', event.code, event.reason);
        stopHeartbeat();

        if (onDisconnect) onDisconnect(event);

        // Don't reconnect if closed cleanly or intentionally
        if (!isClosing && event.code !== 1000) {
            scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket error event
     */
    function handleError(error) {
        console.error('WebSocket error:', error);
        if (onError) onError(error);
    }

    /**
     * Handle incoming WebSocket message
     */
    function handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);

            const handler = handlers[message.type];
            if (handler) {
                handler(message);
            } else {
                console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    function scheduleReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        if (reconnectAttempts >= CONFIG.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            if (onError) onError(new Error('Max reconnection attempts reached'));
            return;
        }

        reconnectAttempts++;
        const delay = CONFIG.reconnectDelay * Math.min(reconnectAttempts, 5);

        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        reconnectTimer = setTimeout(connect, delay);
    }

    /**
     * Start the heartbeat ping interval
     */
    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, CONFIG.heartbeatInterval);
    }

    /**
     * Stop the heartbeat ping interval
     */
    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    /**
     * Send a message to the server
     * @param {string} action - Action type
     * @param {Object} [data={}] - Additional data
     * @returns {boolean} True if message was sent
     */
    function send(action, data = {}) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not connected, cannot send:', action);
            return false;
        }

        const message = { action, ...data };
        console.log('Sending:', message);
        ws.send(JSON.stringify(message));
        return true;
    }

    /**
     * Close the WebSocket connection
     */
    function close() {
        isClosing = true;
        stopHeartbeat();

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (ws) {
            ws.close(1000, 'Client closing');
            ws = null;
        }
    }

    /**
     * Check if the socket is connected
     * @returns {boolean} True if connected
     */
    function isConnected() {
        return ws && ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get the current connection state
     * @returns {string} Connection state: 'connected', 'connecting', 'disconnected'
     */
    function getState() {
        if (!ws) return 'disconnected';
        switch (ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            default: return 'disconnected';
        }
    }

    return {
        connect,
        send,
        close,
        isConnected,
        getState
    };
}

/**
 * Build a WebSocket URL for the host view
 * @param {string} roomCode - The room code
 * @returns {string} WebSocket URL
 */
export function buildHostUrl(roomCode) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/host/${roomCode}`;
}

/**
 * Build a WebSocket URL for the player view
 * @param {string} roomCode - The room code
 * @param {string} playerId - The player ID
 * @returns {string} WebSocket URL
 */
export function buildPlayerUrl(roomCode, playerId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/player/${roomCode}/${playerId}`;
}
