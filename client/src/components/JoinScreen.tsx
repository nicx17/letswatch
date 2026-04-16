import { Sparkles, Users } from 'lucide-react';


interface JoinScreenProps {
  displayName: string;
  setDisplayName: (name: string) => void;
  roomId: string;
  setRoomId: (id: string) => void;
  roomPin: string;
  setRoomPin: (pin: string) => void;
  handleCreateRoom: () => void;
  handleJoin: () => void;
}

export function JoinScreen({
  displayName,
  setDisplayName,
  roomId,
  setRoomId,
  roomPin,
  setRoomPin,
  handleCreateRoom,
  handleJoin,
}: Readonly<JoinScreenProps>) {
  return (
    <section className="grid flex-1 content-start gap-8 lg:grid-cols-[1.15fr_0.85fr] xl:gap-10">
      <div className="chrome-panel panel-feature rounded-[32px] p-8 sm:p-10 lg:p-12">
        <div className="space-y-6">
          <div className="eyebrow">
            <Sparkles size={14} />
            <span>Watch together</span>
          </div>
          <h2 className="section-title max-w-4xl text-[var(--text-main)]">
            Watch together, beautifully.
          </h2>
          <p className="max-w-3xl text-[1.05rem] leading-8 text-[var(--text-muted)] sm:text-[1.12rem]">
            Bring your own video, invite someone into the same room, and enjoy a setup that feels calm, polished,
            and easy to use from the first click.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          <div className="info-tile">
            <span className="info-tile-title">Bring your file</span>
            <span className="info-tile-copy">Open the video you already have and keep the full quality.</span>
          </div>
          <div className="info-tile">
            <span className="info-tile-title">Shared control</span>
            <span className="info-tile-copy">Anyone in the room can play, pause, and scrub the timeline.</span>
          </div>
          <div className="info-tile">
            <span className="info-tile-title">Room atmosphere</span>
            <span className="info-tile-copy">Switch between Midnight, Ocean, Romance, Forest, and Ivory.</span>
          </div>
        </div>
      </div>

      <div className="chrome-panel panel-form rounded-[32px] p-8 sm:p-10 lg:p-12">
        <div className="space-y-3">
          <p className="eyebrow">
            <Users size={14} />
            <span>Join a session</span>
          </p>
          <h2 className="section-title text-[var(--text-main)]">Enter your room code</h2>
          <p className="text-base leading-7 text-[var(--text-muted)]">
            Pick your own room code and 6-digit PIN, or join with credentials someone shared with you.
          </p>
        </div>

        <form
          className="mt-10 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            handleJoin();
          }}
        >
          <label htmlFor="join-display-name" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
            Your name
          </label>
          <input
            id="join-display-name"
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder="Movie buddy"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-shell"
            maxLength={24}
          />
          <label htmlFor="join-room-code" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
            Room code
          </label>
          <input
            id="join-room-code"
            name="roomCode"
            type="text"
            autoComplete="username"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD2345"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            className="input-shell"
          />
          <label htmlFor="join-room-pin" className="block text-xs font-semibold uppercase tracking-[0.28em] text-[var(--text-muted)]">
            Room PIN
          </label>
          <input
            id="join-room-pin"
            name="roomPin"
            type="password"
            autoComplete="current-password"
            placeholder="123456"
            value={roomPin}
            onChange={(e) => setRoomPin(e.target.value.replaceAll(/\D/g, '').slice(0, 6))}
            className="input-shell"
            inputMode="numeric"
            maxLength={6}
          />
          <button type="button" onClick={handleCreateRoom} className="primary-button w-full" disabled={!roomId || !roomPin}>
            Create Room
          </button>
          <button type="submit" className="secondary-button w-full" disabled={!roomId || !roomPin}>
            Enter Room
          </button>
        </form>
      </div>
    </section>
  );
}
