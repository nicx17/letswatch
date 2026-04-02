# Security Notes

## Scope

Lets Watch is designed around a local-first media model:

- Video files stay on each participant's machine.
- The server only stores room metadata and playback state in memory.
- No database, file upload pipeline, or persistent media storage is part of the current architecture.

That keeps the data surface small, but it does not eliminate the need for runtime hardening on the sync layer.

## Controls Currently Implemented

### HTTP and Browser-Facing Headers

The Express server uses `helmet` to set security-focused response headers and a custom CSP that still allows:

- local media playback from `blob:`
- inline styles used by the current frontend
- Cloudflare Insights scripts if they are enabled

The server also enables `compression` for text-based responses.

### Input Validation

Incoming `sync_state` payloads are validated with Zod before room state is updated. This prevents malformed payloads from being written into the shared in-memory state map.

### Room Membership And Leader Enforcement

Room-scoped events now require the socket to be part of the room. Playback updates are additionally restricted to the current room leader, which keeps viewer clients from overwriting shared state.

### Rate Limiting

The backend keeps a lightweight per-socket rate-limit window for room events. It is intentionally simple and in-memory, which makes it suitable for a single-process deployment but not for distributed rate limiting across multiple instances.

### Room Cleanup

Room membership is cleaned up on disconnect. Empty rooms are deleted, and leadership is reassigned to the next participant when the current leader leaves.

### Static Asset Caching

Production static files are served with cache settings that match their role:

- fingerprinted assets under `/assets` are cached long-term
- `index.html` is intentionally not cached

## Important Limitations

These are not hidden footnotes. They are the current boundaries of the implementation and should be considered before exposing the service publicly.

### Room Access Is Based On Knowing The Room ID

There is no server-side authentication, password, or signed join token today. Anyone who can connect to the server and guess or obtain a room ID can attempt to interact with that room.

### CORS Is Not Authorization

The project configures CORS for Express and Socket.IO polling requests, but CORS does not stop non-browser clients from reaching the backend. Socket.IO's WebSocket transport is also not governed by browser CORS in the same way. Treat CORS here as browser configuration, not as access control.

### Rate Limiting Is Process-Local

The current limiter uses an in-memory `Map`. It resets on restart and does not coordinate across replicas.

### State Is Ephemeral

All room state lives in memory. Restarting the server clears active rooms.

## Recommended Next Security Steps

- Add room authentication such as a PIN, invite token, or signed join payload.
- Move rate limiting to a shared store if the service is scaled horizontally.
- Add structured logging and alerting around rejected payloads and abuse spikes.

## Repository Security Workflow

The repo now includes:

- CI checks for lint, test, and build
- CodeQL scanning for JavaScript and TypeScript
- dependency review checks on pull requests

Together, those workflows help catch regressions early, but they do not replace application-layer authorization and threat modeling.
