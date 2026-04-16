import { useRef, useState } from 'react';
import type { AudioTrackInfo, SyncState } from '../types';

export function useVideoMedia(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  latestRoomStateRef: React.RefObject<SyncState | null>,
  clientLog: (level: 'info' | 'warn' | 'error', event: string, meta?: Record<string, unknown>) => void
) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [subtitleSrc, setSubtitleSrc] = useState<string | null>(null);
  const [subtitleLabel, setSubtitleLabel] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [drift, setDrift] = useState(0);

  const objectUrlRef = useRef<string | null>(null);
  const subtitleUrlRef = useRef<string | null>(null);

  const applyState = (state: SyncState) => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const diff = Math.abs(video.currentTime - state.position);

    if (state.playing) {
      if (diff > 2) {
        video.currentTime = state.position;
      }
      if (video.paused) {
        video.play().catch((err) => {
          clientLog('warn', 'video.play_failed', { error: String(err) });
        });
      }
    } else {
      if (diff > 0.1) {
        video.currentTime = state.position;
      }
      if (!video.paused) {
        video.pause();
      }
    }
  };

  const clearSubtitleTrack = () => {
    if (videoRef.current) {
      Array.from(videoRef.current.textTracks).forEach((track) => {
        track.mode = 'disabled';
      });
    }

    if (subtitleUrlRef.current) {
      URL.revokeObjectURL(subtitleUrlRef.current);
      subtitleUrlRef.current = null;
    }

    setSubtitleSrc(null);
    setSubtitleLabel(null);
  };

  const convertSrtToVtt = (srtText: string): string => {
    const vttBody = srtText
      // Prevent XSS through WebVTT HTML rendering by escaping meta-characters
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      // Standard SRT to VTT formatting
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll(/^\d+\n/gm, '')
      .replaceAll(/,(\d{3})/g, '.$1');
    return `WEBVTT\n\n${vttBody}`;
  };

  const handleSubtitleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    clearSubtitleTrack();

    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    let nextSubtitleUrl: string;

    if (fileExtension === 'srt') {
      const srtText = await file.text();
      const vttBlob = new Blob([convertSrtToVtt(srtText)], { type: 'text/vtt' });
      nextSubtitleUrl = URL.createObjectURL(vttBlob);
    } else {
      nextSubtitleUrl = URL.createObjectURL(file);
    }

    subtitleUrlRef.current = nextSubtitleUrl;
    setSubtitleSrc(nextSubtitleUrl);
    setSubtitleLabel(file.name);
    e.target.value = '';
  };

  const applyVideoFile = (file: File) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoSrc(url);
    setVideoLabel(file.name);
  };

  const clearVideoFile = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    clearSubtitleTrack();
    setVideoSrc(null);
    setVideoLabel(null);
    setDrift(0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    applyVideoFile(file);
    e.target.value = '';
  };

  const updateAudioTracksState = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRef.current as any;
    if (video?.audioTracks) {
      const tracksInfo: AudioTrackInfo[] = [];
      for (const track of Array.from(video.audioTracks)) {
        tracksInfo.push({
          id: (track as AudioTrackInfo).id,
          label: (track as AudioTrackInfo).label || `Track ${tracksInfo.length + 1}`,
          language: (track as AudioTrackInfo).language,
          enabled: (track as AudioTrackInfo).enabled,
        });
      }
      setAudioTracks(tracksInfo);
    }
  };

  const handleAudioTrackSwitch = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const trackId = e.target.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRef.current as any;
    if (video?.audioTracks) {
      for (const track of Array.from(video.audioTracks)) {
        (track as AudioTrackInfo).enabled = (track as AudioTrackInfo).id === trackId;
      }
      updateAudioTracksState();
    }
  };

  const showSubtitleTrack = (videoElement: HTMLVideoElement | null, turnOn: boolean) => {
    if (!videoElement) return;

    const tracks = Array.from(videoElement.textTracks);
    if (!tracks.length) return;

    tracks.forEach((track) => {
      track.mode = 'disabled';
    });

    if (turnOn) {
      const activeTrack = tracks.find((t) => t.kind === 'subtitles' || t.kind === 'captions');
      if (activeTrack) {
        activeTrack.mode = 'showing';
      }
    }
  };

  const handleVideoLoadedMetadata = () => {
    showSubtitleTrack(videoRef.current, Boolean(subtitleSrc));
    
    updateAudioTracksState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const video = videoRef.current as any;
    if (video?.audioTracks) {
      video.audioTracks.addEventListener('change', updateAudioTracksState);
      video.audioTracks.addEventListener('addtrack', updateAudioTracksState);
      video.audioTracks.addEventListener('removetrack', updateAudioTracksState);
    }

    if (latestRoomStateRef.current) {
      applyState(latestRoomStateRef.current);
    }
  };

  return {
    videoSrc,
    videoLabel,
    subtitleSrc,
    subtitleLabel,
    audioTracks,
    drift,
    setDrift,
    applyState,
    clearVideoFile,
    handleFileChange,
    handleSubtitleChange,
    clearSubtitleTrack,
    handleAudioTrackSwitch,
    handleVideoLoadedMetadata,
  };
}
