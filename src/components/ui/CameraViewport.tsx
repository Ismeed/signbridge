'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  Camera,
  CameraOff,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';
import { InterpretationState } from '@/lib/types';
import { neuralVision, TrackingFrame } from '@/lib/neuralVision';
import { SpeechService } from '@/lib/speech';
import { useApp } from '@/context/AppContext';

interface CameraViewportProps {
  state: InterpretationState;
  onCameraToggle?: (active: boolean) => void;
  onPersonDetect?: (detected: boolean) => void;
  onTrackingFrame?: (frame: TrackingFrame, facingMode: 'user' | 'environment') => void;
  onTrackerReadyChange?: (ready: boolean) => void;
  isSimulatedDemo?: boolean;
  forceEnglish?: boolean;
}

const ENGLISH_STUDIO_LABELS: Record<string, string> = {
  'interpret.locked': 'Tracked',
  'interpret.scanning': 'Scanning',
  'interpret.demo': 'Demo',
  'interpret.standby': 'Standby',
  'interpret.trackerLoading': 'Loading AI...',
  'interpret.cameraOffPrompt': 'Tap Start Camera to record NSL clips.',
  'interpret.cameraStart': 'Start Camera',
  'interpret.cameraStop': 'Stop Camera',
};

export function CameraViewport({
  onCameraToggle,
  onPersonDetect,
  onTrackingFrame,
  onTrackerReadyChange,
  isSimulatedDemo = false,
  forceEnglish = false,
}: CameraViewportProps) {
  const { t } = useApp();
  const label = (key: string): string =>
    forceEnglish && ENGLISH_STUDIO_LABELS[key] ? ENGLISH_STUDIO_LABELS[key] : t(key);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const onCameraToggleRef = useRef(onCameraToggle);
  const onPersonDetectRef = useRef(onPersonDetect);
  const onTrackingFrameRef = useRef(onTrackingFrame);
  const onTrackerReadyChangeRef = useRef(onTrackerReadyChange);
  useEffect(() => {
    onCameraToggleRef.current = onCameraToggle;
    onPersonDetectRef.current = onPersonDetect;
    onTrackingFrameRef.current = onTrackingFrame;
    onTrackerReadyChangeRef.current = onTrackerReadyChange;
  }, [onCameraToggle, onPersonDetect, onTrackingFrame, onTrackerReadyChange]);

  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const cameraActiveRef = useRef<boolean>(false);
  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const facingModeRef = useRef<'user' | 'environment'>('user');
  useEffect(() => {
    facingModeRef.current = facingMode;
  }, [facingMode]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [trackerReady, setTrackerReady] = useState<boolean>(() => neuralVision.isReady());
  const trackerReadyRef = useRef<boolean>(trackerReady);
  const [showNeuralOverlays, setShowNeuralOverlays] = useState<boolean>(true);
  const showNeuralOverlaysRef = useRef<boolean>(true);
  useEffect(() => {
    showNeuralOverlaysRef.current = showNeuralOverlays;
  }, [showNeuralOverlays]);

  const [telemetry, setTelemetry] = useState<{
    isPersonTracked: boolean;
    fps: number;
    handsCount: number;
  }>({
    isPersonTracked: false,
    fps: 60,
    handsCount: 0,
  });

  const lastTelemetryUpdateRef = useRef<number>(0);
  const lastPersonTrackedRef = useRef<boolean>(false);

  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    dimensionsRef.current = dimensions;
  }, [dimensions]);

  // Match canvas resolution to container dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const w = Math.round(width);
          const h = Math.round(height);
          setDimensions({ width: w, height: h });
          if (canvasRef.current) {
            canvasRef.current.width = w;
            canvasRef.current.height = h;
          }
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Pre-initialize neural vision engine
  useEffect(() => {
    let active = true;
    neuralVision
      .init()
      .then((ready) => {
        if (!active) return;
        trackerReadyRef.current = ready;
        setTrackerReady(ready);
        onTrackerReadyChangeRef.current?.(ready);
      })
      .catch((err) => {
        console.warn('Neural vision engine init notice:', err);
      });
    return () => {
      active = false;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    cameraActiveRef.current = false;
    setCameraActive(false);
    if (onCameraToggleRef.current) onCameraToggleRef.current(false);
    if (onPersonDetectRef.current) onPersonDetectRef.current(false);
  }, []);

  // Clean up hardware stream on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const startCamera = async (targetFacing: 'user' | 'environment' = facingMode) => {
    setCameraError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError('Camera access requires HTTPS or localhost.');
      return;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = async () => {
          try {
            await video.play();
            cameraActiveRef.current = true;
            setCameraActive(true);
            if (onCameraToggleRef.current) onCameraToggleRef.current(true);
          } catch (playErr: unknown) {
            const msg = playErr instanceof Error ? playErr.message : 'Playback error';
            setCameraError('Failed to start video: ' + msg);
          }
        };
      }
    } catch (err: unknown) {
      const errorObj = err as { name?: string; message?: string };
      if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
        setCameraError('Camera permission denied. Allow access in browser settings.');
      } else if (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError') {
        setCameraError(`No ${targetFacing === 'user' ? 'front' : 'rear'} camera found.`);
      } else {
        setCameraError('Could not start camera: ' + (errorObj.message || 'Unknown error'));
      }
      cameraActiveRef.current = false;
      setCameraActive(false);
      if (onCameraToggleRef.current) onCameraToggleRef.current(false);
    }
  };

  const toggleCamera = () => {
    if (cameraActive) {
      stopCamera();
    } else {
      SpeechService.unlockAudio();
      startCamera(facingMode);
    }
  };

  const switchFacingMode = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    if (cameraActive) {
      startCamera(nextMode);
    }
  };

  // Continuous render & vision tracking loop
  useEffect(() => {
    let active = true;

    const renderLoop = (time: number) => {
      if (!active) return;

      const canvas = canvasRef.current;
      const video = videoRef.current;
      const { width, height } = dimensionsRef.current;

      if (canvas && width > 0 && height > 0) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          let frame: TrackingFrame;

          if (
            cameraActiveRef.current &&
            video &&
            video.readyState >= 2 &&
            !video.paused &&
            !video.ended
          ) {
            frame = neuralVision.processVideoFrame(video, time);

            if (frame.trackerReady && !trackerReadyRef.current) {
              trackerReadyRef.current = true;
              setTrackerReady(true);
              onTrackerReadyChangeRef.current?.(true);
            }

            if (
              frame.trackerReady !== false &&
              frame.isNewVideoFrame !== false &&
              onTrackingFrameRef.current
            ) {
              onTrackingFrameRef.current(frame, facingModeRef.current);
            }

            if (frame.isPersonTracked !== lastPersonTrackedRef.current) {
              lastPersonTrackedRef.current = frame.isPersonTracked;
              if (onPersonDetectRef.current) {
                onPersonDetectRef.current(frame.isPersonTracked);
              }
            }

            if (time - lastTelemetryUpdateRef.current > 300) {
              lastTelemetryUpdateRef.current = time;
              setTelemetry({
                isPersonTracked: frame.isPersonTracked,
                fps: frame.fps,
                handsCount:
                  (frame.leftHandLandmarks ? 1 : 0) + (frame.rightHandLandmarks ? 1 : 0),
              });
            }

            if (showNeuralOverlaysRef.current) {
              const isFrontCamera = facingModeRef.current === 'user';
              neuralVision.renderHUD(
                ctx,
                frame,
                width,
                height,
                isFrontCamera,
                video.videoWidth,
                video.videoHeight
              );
            } else {
              ctx.clearRect(0, 0, width, height);
            }
          } else if (isSimulatedDemo) {
            frame = neuralVision.generateSimulatedFrame(time);
            if (showNeuralOverlaysRef.current) {
              neuralVision.renderHUD(ctx, frame, width, height, false);
            } else {
              ctx.clearRect(0, 0, width, height);
            }
          } else {
            ctx.clearRect(0, 0, width, height);
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      active = false;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isSimulatedDemo]);

  const statusDotClass = cameraActive
    ? telemetry.isPersonTracked
      ? 'bg-emerald-400'
      : 'bg-cyan-400 animate-pulse'
    : isSimulatedDemo
    ? 'bg-cyan-400 animate-pulse'
    : 'bg-slate-500';

  const statusLabel = cameraActive
    ? !trackerReady
      ? ENGLISH_STUDIO_LABELS['interpret.trackerLoading']
      : telemetry.isPersonTracked
      ? telemetry.handsCount > 0
        ? `${label('interpret.locked')} • ${telemetry.handsCount}H`
        : label('interpret.locked')
      : label('interpret.scanning')
    : isSimulatedDemo
    ? label('interpret.demo')
    : label('interpret.standby');

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden border border-white/10 bg-[#0a101d] shadow-xl app-card-surface"
    >
      {/* Subtle Ambient Background */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.12),transparent_70%)] pointer-events-none" />

      {/* Live Video Stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={clsx(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none',
          facingMode === 'user' && 'scale-x-[-1]'
        )}
      />

      {/* Landmark Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* Minimal Standby Prompt */}
      {!cameraActive && !isSimulatedDemo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center select-none z-10">
          <div className="w-14 h-14 rounded-2xl bg-slate-900/90 border border-white/10 flex items-center justify-center mb-3">
            <Camera className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-xs font-medium text-slate-300 max-w-[220px]">
            {label('interpret.cameraOffPrompt')}
          </p>
        </div>
      )}

      {/* Top Overlay Controls */}
      <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between z-20">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-slate-200">
          <span className={clsx('w-1.5 h-1.5 rounded-full', statusDotClass)} />
          <span>{statusLabel}</span>
        </div>

        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-md p-1 rounded-full border border-white/10">
          <button
            onClick={switchFacingMode}
            className="px-2 py-1 rounded-full text-slate-200 hover:text-cyan-300 transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-semibold"
            aria-label={`Switch to ${facingMode === 'user' ? 'Rear' : 'Front'} Camera`}
          >
            <RefreshCw className="w-3 h-3 text-cyan-400" />
            <span>{facingMode === 'user' ? 'Front' : 'Rear'}</span>
          </button>

          <button
            onClick={() => setShowNeuralOverlays(!showNeuralOverlays)}
            className="p-1 rounded-full text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
            aria-label="Toggle Neural Tracking HUD"
          >
            {showNeuralOverlays ? (
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* Bottom Camera Power Bar */}
      <div className="absolute bottom-2.5 inset-x-2.5 flex items-center justify-between z-20">
        {cameraActive ? (
          <span className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-slate-300">
            {telemetry.fps} FPS
          </span>
        ) : (
          <span />
        )}

        <button
          id="btn-toggle-camera"
          onClick={toggleCamera}
          className={clsx(
            'px-3.5 py-2 rounded-full font-bold flex items-center gap-1.5 text-xs transition-all active:scale-95 cursor-pointer shadow-lg',
            cameraActive
              ? 'bg-rose-500/90 hover:bg-rose-500 text-white'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
          )}
          aria-label={cameraActive ? label('interpret.cameraStop') : label('interpret.cameraStart')}
        >
          {cameraActive ? (
            <>
              <CameraOff className="w-3.5 h-3.5" />
              <span>{label('interpret.cameraStop')}</span>
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5" />
              <span>{label('interpret.cameraStart')}</span>
            </>
          )}
        </button>
      </div>

      {/* Camera Error Notice */}
      {cameraError && (
        <div className="absolute top-12 inset-x-3 p-3 rounded-2xl bg-rose-950/95 border border-rose-500/40 text-rose-100 text-xs z-30 shadow-xl backdrop-blur-md flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-snug text-rose-100">{cameraError}</p>
          </div>
          <button
            onClick={() => setCameraError(null)}
            className="text-[11px] font-semibold text-white underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
