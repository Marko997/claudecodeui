import { WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type {
  LLMProvider,
  NormalizedMessage,
  RealtimeClientConnection,
} from '@/shared/types.js';
import { createCompleteMessage, readObjectRecord } from '@/shared/utils.js';

type ChatSessionWriterOptions = {
  connection: RealtimeClientConnection;
  userId: string | number | null;
  provider: LLMProvider;
  /** Provider-native id when resuming an existing session, otherwise null. */
  providerSessionId: string | null;
  /**
   * Invoked the moment the provider runtime reveals its native session id
   * (either via `setSessionId` or a `session_created` event). The registry
   * persists the app-id-to-provider-id mapping from this callback.
   */
  onProviderSessionId: (providerSessionId: string) => void;
  /**
   * Remaps/sequences/buffers one outbound live event. Implemented by the chat
   * run registry; the writer never forwards a provider event untouched.
   * Returns `null` when the event must be dropped (duplicate terminal
   * `complete` after an abort already completed the run).
   */
  decorateOutboundEvent: (message: NormalizedMessage) => NormalizedMessage | null;
};

/**
 * Gateway writer handed to provider runtimes instead of a raw websocket writer.
 *
 * It exposes the exact same surface as `WebSocketWriter` (`send`,
 * `setSessionId`, `getSessionId`, `updateWebSocket`, `userId`,
 * `isWebSocketWriter`) so the provider runtime adapters need zero changes —
 * but everything that flows through
 * it is translated from the provider's world into the app's protocol:
 *
 * - `session_created` events are swallowed and turned into a provider-id
 *   mapping; the frontend never learns provider-native ids.
 * - every other event gets `sessionId` remapped to the app session id and a
 *   per-run `seq` assigned before being forwarded.
 * - `setSessionId(...)` calls (used by runtimes to label captured ids) are
 *   intercepted and recorded as the provider-id mapping as well.
 */
export class ChatSessionWriter {
  userId: string | number | null;
  /**
   * Some runtimes feature-detect their writer with this flag; keep it so the
   * gateway writer is a drop-in replacement for `WebSocketWriter`.
   */
  isWebSocketWriter = true;

  /**
   * Every client currently watching this run.
   *
   * A run is owned by a session, not by the socket that started it: the same
   * session open on a laptop and a phone must see the same stream. Each event
   * is therefore fanned out to all attached connections, and sockets that have
   * gone away are pruned on the next send.
   */
  private readonly connections = new Set<RealtimeClientConnection>();

  private readonly options: ChatSessionWriterOptions;
  /**
   * The provider-native session id as the runtime knows it. Kept locally
   * (besides the registry) because runtimes read it back via `getSessionId()`
   * to label their own outgoing events — those labels are remapped on send
   * anyway, but the runtime-visible value must stay provider-native.
   */
  private providerSessionId: string | null;

  constructor(options: ChatSessionWriterOptions) {
    this.options = options;
    this.connections.add(options.connection);
    this.userId = options.userId;
    this.providerSessionId = options.providerSessionId;
  }

  /**
   * Mirrors an already-app-shaped event to every watcher except `origin`,
   * bypassing run decoration.
   *
   * Used for the user's own prompt: the sending client rendered it
   * optimistically the moment it was typed, while other devices watching the
   * same session have no way to learn about it until they refetch history.
   *
   * Deliberately not recorded in the replay buffer. Replay is keyed by `seq`
   * and knows nothing about who sent what, so a buffered prompt would come
   * back to its own sender on the next reconnect and render twice. Clients
   * that join later pick the prompt up from persisted history, which is the
   * authoritative source anyway.
   */
  mirrorToOthers(message: NormalizedMessage, origin: RealtimeClientConnection): void {
    this.forward(message, origin);
  }

  send(data: unknown): void {
    const record = readObjectRecord(data);
    if (!record || typeof record.kind !== 'string') {
      // Provider runtimes only emit kind-based normalized messages. Anything
      // else indicates a programming error; drop it rather than leaking an
      // un-remapped payload to the client.
      console.error('[ChatSessionWriter] Dropping non-normalized outbound payload', data);
      return;
    }

    const message = record as NormalizedMessage;

    if (message.kind === 'session_created') {
      const announcedId =
        typeof message.newSessionId === 'string' && message.newSessionId
          ? message.newSessionId
          : message.sessionId;
      if (announcedId) {
        this.captureProviderSessionId(announcedId);
      }
      // Swallowed on purpose: the frontend already has the stable app session
      // id, so there is no client-side handoff to perform anymore.
      return;
    }

    const outbound = this.options.decorateOutboundEvent(message);
    if (outbound) {
      this.forward(outbound);
    }
  }

  /**
   * Emits the synthetic terminal `complete` for runs that ended without one
   * (runtime crash before completing, or user abort).
   */
  sendComplete(opts: { exitCode: number; aborted?: boolean }): void {
    const message = createCompleteMessage({
      provider: this.options.provider,
      sessionId: this.providerSessionId,
      exitCode: opts.exitCode,
      aborted: opts.aborted,
    });
    const outbound = this.options.decorateOutboundEvent(message);
    if (outbound) {
      this.forward(outbound);
    }
  }

  /**
   * Adds a client to the run's live stream. Named for `WebSocketWriter`
   * parity, but additive: a reconnecting socket joins the existing watchers
   * instead of displacing them.
   */
  updateWebSocket(newConnection: RealtimeClientConnection): void {
    this.addConnection(newConnection);
  }

  addConnection(connection: RealtimeClientConnection): void {
    this.connections.add(connection);
  }

  /**
   * Drops a client from the run's live stream. Called when a socket closes so
   * a long-running run does not retain dead connections until its next send.
   */
  removeConnection(connection: RealtimeClientConnection): void {
    this.connections.delete(connection);
  }

  /** Number of clients currently receiving this run's events. */
  get connectionCount(): number {
    return this.connections.size;
  }

  setSessionId(sessionId: string): void {
    this.captureProviderSessionId(sessionId);
  }

  getSessionId(): string | null {
    return this.providerSessionId;
  }

  private captureProviderSessionId(providerSessionId: string): void {
    if (!providerSessionId || this.providerSessionId === providerSessionId) {
      return;
    }

    this.providerSessionId = providerSessionId;
    this.options.onProviderSessionId(providerSessionId);
  }

  private forward(message: NormalizedMessage, origin?: RealtimeClientConnection): void {
    // Serialize once — a busy run fans the same payload out to every watcher.
    const payload = JSON.stringify(message);
    for (const connection of this.connections) {
      if (connection === origin) {
        continue;
      }
      if (connection.readyState === WS_OPEN_STATE) {
        connection.send(payload);
      } else {
        // Deleting during iteration is well-defined for Set and keeps closed
        // sockets from accumulating across a long run.
        this.connections.delete(connection);
      }
    }
  }
}
