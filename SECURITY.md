# Security Notes

## Scope

Lets Watch is designed around a local-first media model:

- Video files stay on each participant's machine.
- The server only stores room metadata and playback state in memory while a room is active.
- Chat is broadcast live and is not persisted in memory after delivery.
- No database, file upload pipeline, or persistent media storage is part of the current architecture.

That keeps the data surface small, but it does not eliminate the need for runtime hardening on the sync layer.

## Controls Currently Implemented

### HTTP and Browser-Facing Headers

The Express server uses `helmet` and a custom CSP response-header middleware.

Current behavior includes:

- nonce-based `script-src` with `strict-dynamic` support for stronger XSS resistance (without `unsafe-inline` in scripts)
- Trusted Types policy-name restrictions in CSP (`trusted-types default`)
- HSTS in production with long max-age, subdomains, and preload

Strict Trusted Types sink enforcement currently runs in `Content-Security-Policy-Report-Only` mode (`require-trusted-types-for 'script'`) with reports sent to `/csp-violation-report` for telemetry. This preserves runtime compatibility while collecting hard data needed before full enforcement.

The CSP still allows:

- local media playback from `blob:`
- inline styles used by the current frontend
- Cloudflare Insights scripts if they are enabled

The server also enables `compression` for text-based responses.

To keep nonce injection reliable, production `index.html` is not served directly by static middleware; the app serves it through a response path that injects nonces per request.

### Input Validation

Incoming `sync_state` payloads are validated with Zod before room state is updated. This prevents malformed payloads from being written into the shared in-memory state map.

Chat payloads are also validated:

- text messages must be non-empty and stay within the server-side length cap
- image messages must be `data:image/...;base64,...` payloads and stay under the configured payload limit
- display names are length-bounded before they are accepted

### Room Membership Enforcement

Room-scoped events require the socket to be part of the room before the backend will return or update shared playback state.

### Room Credentials

Rooms are now created with:

- a user-chosen room code
- a 6-digit PIN required for join and reconnect
- a room-specific share token used in copied invite links

The server stores only a salted hash of the PIN in memory for the active room lifetime.
It also stores only a hash of the active share token in memory rather than the raw token.
Room codes are normalized to uppercase before lookup, and PIN values are trimmed before hash verification so harmless input formatting does not cause false credential failures.

PIN hashes now use a versioned scrypt format for new rooms, and verification keeps a backward-compatible fallback path for legacy hash values.

### Rate Limiting

The backend keeps a lightweight per-socket rate-limit window for room events. It is intentionally simple and in-memory, which makes it suitable for a single-process deployment but not for distributed rate limiting across multiple instances.

Authentication-related flows (create room, join with PIN, and join by share link) now have a dedicated throttle budget that is separate from normal room event rate limits.

### Log Privacy

Server logs now sanitize metadata before emission:

- sensitive keys (room IDs, participant IDs, socket IDs, tokens, hashes, pins, and related fields) are obfuscated
- obfuscation is deterministic per value, which preserves correlation without exposing raw secrets
- non-sensitive operational values remain readable for debugging

### Room Cleanup

Room membership is cleaned up on disconnect, and empty rooms are deleted automatically.

Because rooms are deleted when the final participant leaves:

- room playback state is forgotten
- viewer display names are forgotten
- there is no chat history to recover

### Static Asset Caching

Production static files are served with cache settings that match their role:

- fingerprinted assets under `/assets` are cached long-term
- `index.html` is intentionally not cached

## Important Limitations

These are not hidden footnotes. They are the current boundaries of the implementation and should be considered before exposing the service publicly.

### Room Access Is Based On Knowing The Room ID And PIN Or Having A Valid Share Link

The join path is now better than room-ID-only access, but it is still lightweight room authentication rather than user authentication. Anyone who can obtain both the room code and PIN, or a currently valid share link containing the room token, can join and interact with that room.

This matters more now that the room also exposes:

- participant display names
- live chat traffic
- inline image chat messages

PIN-based joins rotate the active share token, which helps invalidate older copied links, but the current model still treats the link itself as a bearer credential.

### CORS Is Not Authorization

The project configures CORS for Express and Socket.IO polling requests, but CORS does not stop non-browser clients from reaching the backend. Socket.IO's WebSocket transport is also not governed by browser CORS in the same way. Treat CORS here as browser configuration, not as access control.

### Rate Limiting Is Process-Local

The current limiter uses an in-memory `Map`. It resets on restart and does not coordinate across replicas.

### Image Chat Still Consumes Bandwidth And Memory In Transit

Image messages are not stored server-side, but they still pass through the Socket.IO server and are broadcast to every connected room participant. Large or frequent image sends can still increase memory pressure, bandwidth use, and client-side rendering cost.

The current implementation reduces that risk by:

- compressing and resizing images in the browser before send
- enforcing a Socket.IO buffer limit on the server
- validating image message size and format with Zod

That is useful hardening, but it is not equivalent to a dedicated media pipeline with quotas or malware scanning.

### State Is Ephemeral

All room state lives in memory. Restarting the server clears active rooms.

### Participant Metadata Is Visible Inside The Room

The server shares room membership updates with all room participants so the UI can show who is present. This is expected product behavior, but it also means display names are visible to everyone who joins that room.

The client now receives opaque participant IDs instead of raw socket IDs, which reduces unnecessary exposure of internal connection identifiers.

## Recommended Next Security Steps

- Add expiry, revocation controls, or narrower scopes to share tokens if rooms are shared broadly.
- Move rate limiting to a shared store if the service is scaled horizontally.
- Add stricter quotas or per-room backoff for image chat if the service is exposed to untrusted users.
- Add structured logging and alerting around rejected payloads and abuse spikes.

## Repository Security Workflow

The repo now includes:

- CI checks for lint, test, and build
- CodeQL scanning for JavaScript and TypeScript
- dependency review checks on pull requests

Together, those workflows help catch regressions early, but they do not replace application-layer authorization and threat modeling.
