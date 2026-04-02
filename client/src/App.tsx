import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { SyncController } from './SyncController';
import { RefreshCw, AlertTriangle, Users, Crown, WifiOff } from 'lucide-react';

interface SyncState {
  playing: boolean;
  position: number;
  updatedAt: number;
}

interface SyncResponse {
  success?: boolean;
  isLeader?: boolean;
  error?: string;
  state?: SyncState;
}

const V_URL = import.meta.env.VITE_SOCKET_URL;
const SOCKET_URL = V_URL ? V_URL : (import.meta.env.PROD ? window.location.origin : `http://${window.location.hostname}:4000`);
const syncController = new SyncController();

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isLeader, setIsLeader] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [drift, setDrift] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const ignoreEvents = useRef({ play: false, pause: false, seek: false });
  
  useEffect(() => {
    const s = io(SOCKET_URL);
    
    setSocket(s);

    s.on('connect', () => {
      setIsConnected(true);
    });

    s.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => { s.disconnect(); };
  }, []);

  // Handle auto-reconnects and room state recovery
  useEffect(() => {
    if (!socket) return;
    
    const handleReconnect = () => {
      if (roomId && isJoined) {
        socket.emit('join_room', roomId, (response: SyncResponse) => {
          if (response.success && response.isLeader !== undefined) {
            setIsLeader(response.isLeader);
          }
        });
      }
    };

    socket.on('connect', handleReconnect);
    return () => {
       socket.off('connect', handleReconnect);
    };
  }, [socket, roomId, isJoined]);

  const handleJoin = () => {
    if (!roomId || !socket) return;
    socket.emit('join_room', roomId, (response: SyncResponse) => {
      if (response.success && response.isLeader !== undefined) {
        setIsJoined(true);
        setIsLeader(response.isLeader);
      } else {
        alert(response.error || 'Failed to join room');
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSrc(url);
    }
  };

  const applyState = (state: SyncState) => {
    if (!videoRef.current) return;
    
    const targetTime = syncController.getTargetTime(state);
    
    if (Math.abs(videoRef.current.currentTime - targetTime) > 0.5) {
      ignoreEvents.current.seek = true;
      videoRef.current.currentTime = targetTime;
    }

    if (state.playing && videoRef.current.paused) {
      ignoreEvents.current.play = true;
      videoRef.current.play().catch(e => console.error("Playback stopped", e));
    } else if (!state.playing && !videoRef.current.paused) {
      ignoreEvents.current.pause = true;
      videoRef.current.pause();
    }
  };

  const handleManualSync = () => {
    if (!socket || !videoRef.current) return;
    
    socket.emit('force_sync_request', roomId, (response: SyncResponse) => {
      if (response && response.state) {
        applyState(response.state);
      }
    });
  };

  useEffect(() => {
    if (!socket) return;

    const onStateUpdated = (state: SyncState) => {
      // Defer to applyState to return early if videoRef is null
      applyState(state);
    };

    const onLeaderChanged = (newLeaderId: string) => {
      setIsLeader(socket.id === newLeaderId);
    };

    const onParticipantsUpdated = (participantList: string[]) => {
      setParticipantsCount(participantList.length);
    };

    socket.on('state_updated', onStateUpdated);
    socket.on('leader_changed', onLeaderChanged);
    socket.on('participants_updated', onParticipantsUpdated);

    return () => {
      socket.off('state_updated', onStateUpdated);
      socket.off('leader_changed', onLeaderChanged);
      socket.off('participants_updated', onParticipantsUpdated);
    };
  }, [socket, isJoined]);

  const handlePlay = () => {
    if (ignoreEvents.current.play) {
        ignoreEvents.current.play = false;
        return;
    }
    if (socket && isJoined && videoRef.current) {
      socket.emit('sync_state', roomId, { 
        position: videoRef.current.currentTime, 
        playing: true 
      });
    }
  };

  const handlePause = () => {
    if (ignoreEvents.current.pause) {
        ignoreEvents.current.pause = false;
        return;
    }
    if (socket && isJoined && videoRef.current) {
      socket.emit('sync_state', roomId, { 
        position: videoRef.current.currentTime, 
        playing: false 
      });
    }
  };

  const handleSeeked = () => {
    if (ignoreEvents.current.seek) {
        ignoreEvents.current.seek = false;
        return;
    }
    if (socket && isJoined && videoRef.current) {
      socket.emit('sync_state', roomId, {
        position: videoRef.current.currentTime,
        playing: !videoRef.current.paused
      });
    }
  };

  useEffect(() => {
    if (!socket || !isJoined) return;
    
    const interval = setInterval(() => {
        socket.emit('force_sync_request', roomId, (resp: SyncResponse) => {
             if (videoRef.current && resp?.state && resp.state.playing) {
                 const currentDrift = syncController.calculateDrift(
                     videoRef.current.currentTime, resp.state
                 );
                 setDrift(currentDrift);
                 if (currentDrift > 2) {
                     handleManualSync();
                 }
             }
        });
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isJoined, roomId]);

  const getDriftColor = () => {
    if (drift < 0.5) return 'text-green-500';
    if (drift < 2.0) return 'text-yellow-500';
    return 'text-red-500';
  };

  const toggleTheme = () => {
    document.documentElement.classList.toggle('dark');
  };

  // Check system preference once on load
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  return (
    <div className="min-h-screen font-sans flex flex-col pt-8 px-6 bg-[var(--bg-primary)] text-[var(--text-main)] transition-colors duration-200">
      
      <header className="mb-12 border-b border-[var(--border-color)] pb-6 flex justify-between items-center max-w-[1400px] mx-auto w-full transition-colors duration-200">
        <div className="flex items-center gap-3">
          <img src="/app-icon.svg" alt="Lets Watch Icon" className="w-10 h-10 object-contain" />
          <h1 className="text-4xl font-serif font-normal m-0 tracking-tight text-[var(--text-main)]">
            Lets Watch
          </h1>
        </div>
        <button 
           onClick={toggleTheme} 
           className="px-5 py-2 font-semibold text-sm rounded-xl bg-[var(--bg-secondary)] border-2 border-[var(--border-color)] hover:border-[var(--border-hover)] hover:-translate-y-0.5 text-[var(--text-main)] shadow-[var(--card-shadow)] transition-all"
        >
           Toggle Theme
        </button>
      </header>

      <main className="flex-grow flex items-start justify-center max-w-[1400px] mx-auto w-full mb-12">
        {!isJoined ? (
          <div className="max-w-md w-full bg-[var(--bg-secondary)] p-10 rounded-2xl border-2 border-[var(--border-color)] shadow-[var(--card-shadow)] transition-all duration-200 mt-[10vh]">
            <h2 className="text-3xl mb-8 text-center font-serif text-[var(--text-main)] font-normal">Join a Session</h2>
            <input 
              type="text" 
              placeholder="Enter Room Code" 
              value={roomId} 
              onChange={e => setRoomId(e.target.value)} 
              className="w-full bg-[var(--bg-primary)] p-4 rounded-xl mb-6 outline-none focus:ring-2 focus:ring-[var(--accent)] border border-[var(--border-color)] transition-all text-lg font-sans text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
            />
            <button 
              onClick={handleJoin} 
              className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-text)] hover:-translate-y-1 transition-all p-4 rounded-xl font-bold text-lg disabled:opacity-50 duration-200"
              disabled={!roomId}
            >
              Enter Room
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-8">
             {!videoSrc ? (
               <div className="bg-[var(--bg-secondary)] w-full h-[60vh] rounded-3xl border-2 border-dashed border-[var(--border-color)] flex flex-col items-center justify-center p-8 transition-all">
                 <p className="text-[var(--text-muted)] mb-8 text-xl text-center max-w-lg font-serif">
                   You are synchronizing your local copy of the video.<br className="mb-2"/>
                   Select your `.mp4`, `.mkv`, or `.webm` file.
                 </p>
                 <div className="relative overflow-hidden inline-block group">
                   <button className="bg-[var(--accent)] text-[var(--accent-text)] group-hover:-translate-y-1 transition-all px-10 py-4 rounded-xl font-bold text-lg cursor-pointer">
                     Browse Files
                   </button>
                   <input 
                     type="file" 
                     accept="video/mp4,video/webm,video/x-matroska" 
                     onChange={handleFileChange}
                     className="absolute top-0 left-0 text-xl font-bold opacity-0 w-full h-full cursor-pointer"
                   />
                 </div>
               </div>
             ) : (
               <div className="flex flex-col xl:flex-row gap-8">
                 {/* Video Player */}
                 <div className="bg-black rounded-3xl overflow-hidden shadow-[var(--card-shadow)] border-2 border-[var(--border-color)] flex-grow relative transition-all">
                   <video 
                     ref={videoRef} 
                     src={videoSrc} 
                     controls 
                     className="w-full aspect-video outline-none"
                     onPlay={handlePlay}
                     onPause={handlePause}
                     onSeeked={handleSeeked}
                   />
                   
                   <div className="bg-[var(--bg-secondary)] text-[var(--text-main)] p-5 flex justify-between items-center border-t-2 border-[var(--border-color)] transition-colors duration-200">
                     <button 
                       onClick={handleManualSync} 
                       className="flex items-center gap-2 bg-[var(--bg-primary)] hover:-translate-y-0.5 transition-all duration-200 px-6 py-3 rounded-xl font-bold border border-[var(--border-color)] text-[var(--text-main)]"
                     >
                       <RefreshCw size={20} className="text-[var(--text-main)]" />
                       Force Sync
                     </button>
                     
                     <div className="flex items-center gap-3 bg-[var(--bg-primary)] px-5 py-2.5 rounded-xl border border-[var(--border-color)] transition-colors">
                       <span className="text-[var(--text-muted)] text-sm uppercase tracking-wider font-bold">Drift:</span>
                       {drift > 0.5 && <AlertTriangle size={20} className={getDriftColor()} />}
                       <span className={`font-mono font-black text-xl ${getDriftColor()}`}>
                         {drift.toFixed(2)}s
                       </span>
                     </div>
                   </div>
                 </div>

                 {/* Sidebar Info */}
                 <div className="xl:w-96 flex flex-col gap-6">
                   {!isConnected && (
                     <div className="bg-red-500/10 text-red-500 rounded-3xl p-5 border-2 border-red-500/20 flex items-center gap-4 transition-all">
                       <WifiOff size={28} />
                       <div>
                         <h4 className="font-bold text-lg leading-tight">Disconnected</h4>
                         <p className="text-sm font-medium opacity-80">Reconnecting to server...</p>
                       </div>
                     </div>
                   )}
                   <div className="bg-[var(--bg-secondary)] rounded-3xl p-8 border-2 border-[var(--border-color)] h-full shadow-[var(--card-shadow)] transition-colors duration-200">
                     <h3 className="font-bold text-2xl mb-8 text-[var(--text-main)] flex items-center justify-between font-serif">
                       Session Info
                       <div className="flex gap-4 items-center">
                         <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm font-bold bg-[var(--bg-primary)] px-3 py-1.5 rounded-lg border border-[var(--border-color)]">
                           <Users size={16} />
                           <span>{participantsCount}</span>
                         </div>
                         {isConnected ? (
                           <span className="relative flex h-3 w-3" title="Connected">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                           </span>
                         ) : (
                           <span className="relative flex h-3 w-3" title="Disconnected">
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                           </span>
                         )}
                       </div>
                     </h3>
                     
                     <div className="mb-6">
                       <label className="text-xs text-[var(--text-muted)] uppercase font-black tracking-wider mb-3 block">Room Code</label>
                       <div className="text-xl bg-[var(--bg-primary)] p-4 rounded-xl text-[var(--text-main)] font-mono break-all border border-[var(--border-color)] transition-colors text-center font-bold">
                         {roomId}
                       </div>
                     </div>

                     <div className="mb-8">
                       <div className={`w-full p-4 flex items-center justify-center gap-3 rounded-xl border-2 font-bold text-lg transition-all ${
                         isLeader 
                         ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-500' 
                         : 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-muted)]'
                       }`}>
                         {isLeader ? (
                           <>
                             <Crown size={20} />
                             <span>You are the Leader</span>
                           </>
                         ) : (
                           <>
                             <Users size={20} />
                             <span>You are a Viewer</span>
                           </>
                         )}
                       </div>
                     </div>
                     
                     <div className="space-y-5 text-[1.1rem] text-[var(--text-muted)] font-medium mt-12">
                       <div className="flex items-center gap-4"><div className="w-2.5 h-2.5 rounded-full bg-[var(--text-main)]"></div> Co-op sync enabled</div>
                       <div className="flex items-center gap-4"><div className="w-2.5 h-2.5 rounded-full bg-[var(--text-main)]"></div> End-to-end WebSocket</div>
                       <div className="flex items-center gap-4"><div className="w-2.5 h-2.5 rounded-full bg-[var(--text-main)]"></div> Local blob full-quality</div>
                     </div>
                   </div>
                 </div>
               </div>
             )}
          </div>
        )}
      </main>

      <footer className="mt-auto mb-6 text-center text-sm text-[var(--text-muted)] font-medium transition-colors flex flex-col items-center justify-center gap-1 opacity-80 hover:opacity-100 duration-300">
        <p className="tracking-wide text-xs">
          &copy; 2026 nickcardoso
        </p>
        <a
          href="https://github.com/nicx17/letswatch"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[var(--accent)] transition-colors underline decoration-[var(--border-color)] hover:decoration-[var(--accent)] underline-offset-4"
        >
          github.com/nicx17/letswatch
        </a>
      </footer>
    </div>
  );
}

export default App;
