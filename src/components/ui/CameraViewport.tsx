'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  Sparkles,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertTriangle,
  Cpu,
} from 'lucide-react';
import { InterpretationState } from '@/lib/types';
import { Badge } from './Badge';
import { neuralVision, TrackingFrame } from '@/lib/neuralVision';
import { useApp } from '@/context/AppContext';

interface CameraViewportProps {
  state: InterpretationState;
  onCameraToggle?: (active: boolean) => void;
  onPersonDetect?: (detected: boolean) => void;
  isSimulatedDemo?: boolean;
}

export function CameraViewport({
  state,
  onCameraToggle,
  onPersonDetect,
  isSimulatedDemo = false,
}: CameraViewportProps) {
  const { preferences, t } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stable callback refs to prevent unnecessary re-renders
  const onCameraToggleRef = useRef(onCameraToggle);
  const onPersonDetectRef = useRef(onPersonDetect);
  useEffect(() => {
    onCameraToggleRef.current = onCameraToggle;
    onPersonDetectRef.current = onPersonDetect;
  }, [onCameraToggle, onPersonDetect]);

  // Camera stream state (strictly rear camera: 'environment')
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const cameraActiveRef = useRef<boolean>(false);
  useEffect(() => {
    cameraActiveRef.current = cameraActive;
  }, [cameraActive]);

  const [cameraError, setCameraError] = useState<string | null>(null);

  // Tracking HUD state & options
  const [showNeuralOverlays, setShowNeuralOverlays] = useState<boolean>(true);
  const showNeuralOverlaysRef = useRef<boolean>(true);
  useEffect(() => {
    showNeuralOverlaysRef.current = showNeuralOverlays;
  }, [showNeuralOverlays]);

  const [telemetry, setTelemetry] = useState<{
    isPersonTracked: boolean;
    isSigningActive: boolean;
    headTilt: number;
    fps: number;
    handsCount: number;
  }>({
    isPersonTracked: false,
    isSigningActive: false,
    headTilt: 0,
    fps: 60,
    handsCount: 0,
  });

  const lastTelemetryUpdateRef = useRef<number>(0);
  const lastPersonTrackedRef = useRef<boolean>(false);

  // Dimensions
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    dimensionsRef.current = dimensions;
  }, [dimensions]);

  // Observe container dimensions for canvas matching
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

  // Pre-initialize neural vision engine on mount
  useEffect(() => {
    neuralVision.init().catch((err) => {
      console.warn('Neural vision engine init notice:', err);
    });
  }, []);

  // Explicit stop camera function
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

  // Cleanup ONLY on true component unmount
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

  // Start Rear Camera only
  const startRearCamera = async () => {
    setCameraError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError('Camera access requires HTTPS or localhost in your browser.');
      return;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      // Force rear-facing camera ('environment')
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
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
          } catch (playErr: any) {
            console.error('Video play error:', playErr);
            setCameraError('Failed to start video playback: ' + playErr.message);
          }
        };
      }
    } catch (err: any) {
      console.error('Rear camera stream error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera access was denied. Please allow camera permissions in your browser bar.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No rear camera was detected on this device.');
      } else {
        setCameraError('Could not start rear camera: ' + (err.message || 'Unknown error'));
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
      startRearCamera();
    }
  };

  // Continuous High-Speed 60FPS Vision & Render Loop (unmirrored for rear camera)
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
            // Live camera inference
            frame = neuralVision.processVideoFrame(video, time);

            if (frame.isPersonTracked !== lastPersonTrackedRef.current) {
              lastPersonTrackedRef.current = frame.isPersonTracked;
              if (onPersonDetectRef.current) {
                onPersonDetectRef.current(frame.isPersonTracked);
              }
            }

            // Throttle React state telemetry updates
            if (time - lastTelemetryUpdateRef.current > 300) {
              lastTelemetryUpdateRef.current = time;
              setTelemetry({
                isPersonTracked: frame.isPersonTracked,
                isSigningActive: frame.isSigningActive,
                headTilt: frame.headTiltAngle,
                fps: frame.fps,
                handsCount:
                  (frame.leftHandLandmarks ? 1 : 0) + (frame.rightHandLandmarks ? 1 : 0),
              });
            }

            if (showNeuralOverlaysRef.current) {
              // mirror = false because this is the rear camera pointing out at the signer
              neuralVision.renderHUD(ctx, frame, width, height, false);
            } else {
              ctx.clearRect(0, 0, width, height);
            }
          } else if (isSimulatedDemo || !cameraActiveRef.current) {
            // Organic simulation for demo mode or standby
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

  const getStatusBadge = () => {
    if (cameraActive) {
      return (
        <Badge variant={telemetry.isPersonTracked ? 'emerald' : 'cyan'} size="sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            {telemetry.isPersonTracked
              ? `Rear Camera: Signer Locked (${telemetry.handsCount > 0 ? `${telemetry.handsCount} Hands` : 'Tracking'})`
              : 'Rear Camera: Scanning...'}
          </span>
        </Badge>
      );
    }

    if (isSimulatedDemo) {
      return (
        <Badge variant="cyan" size="sm">
          <Sparkles className="w-3 h-3 text-cyan-300 animate-pulse" />
          <span>Rear Camera Vision Simulation</span>
        </Badge>
      );
    }

    return (
      <Badge variant="slate" size="sm">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        <span>Rear Camera Standby</span>
      </Badge>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/5] sm:aspect-[4/3] rounded-3xl overflow-hidden border-2 border-cyan-500/30 bg-[#070e1e] shadow-2xl transition-all"
    >
      {/* Background Matrix Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.18),transparent_70%)] pointer-events-none" />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56, 189, 248, 0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.25) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* Actual Live Video Element (Unmirrored for true rear camera orientation) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          cameraActive ? 'opacity-95' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Real-Time Holographic Neural Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* Dormant Camera Visualizer with Technical Explanation */}
      {!cameraActive && !isSimulatedDemo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none z-10">
          <div className="relative w-32 h-36 mb-3 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-cyan-500/30 animate-radar" />
            <div className="absolute inset-4 rounded-full border border-indigo-500/25" />

            <svg
              viewBox="0 0 160 190"
              className="w-full h-full text-cyan-400/40 drop-shadow-[0_0_15px_rgba(6,182,212,0.3)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="80" cy="45" r="22" strokeDasharray="3 3" />
              <ellipse cx="80" cy="46" rx="16" ry="20" stroke="currentColor" strokeOpacity="0.8" />
              <path
                d="M32 140 C35 98, 55 86, 80 86 C105 86, 125 98, 128 140"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <circle cx="48" cy="116" r="10" stroke="rgba(0,242,254,0.5)" strokeDasharray="2 2" />
              <circle cx="112" cy="116" r="10" stroke="rgba(0,242,254,0.5)" strokeDasharray="2 2" />
            </svg>
          </div>

          <p className="text-sm font-bold text-white">Rear Camera Neural Tracker</p>
          <p className="text-xs text-slate-300 mt-1 max-w-[280px] leading-relaxed">
            Position your rear camera facing the signer. Tap <strong className="text-cyan-300">Start Rear Camera</strong> to track face, head movement, and hands in real-time.
          </p>

          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-cyan-300/80 bg-slate-900/80 px-2.5 py-1 rounded-full border border-cyan-500/20">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Rear camera dedicated • 100% on-device WebGL processing</span>
          </div>
        </div>
      )}

      {/* Top HUD Overlay Bar */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between z-20">
        <div className="flex items-center gap-1.5">{getStatusBadge()}</div>

        <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full border border-cyan-500/30 shadow-lg">
          {/* Rear Camera dedicated tag */}
          <span className="text-[10px] font-mono text-cyan-300 uppercase tracking-wider font-semibold">
            Rear Cam
          </span>

          {/* Toggle landmark overlays */}
          <button
            onClick={() => setShowNeuralOverlays(!showNeuralOverlays)}
            className="p-1 rounded-full text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer ml-1"
            title={showNeuralOverlays ? 'Hide Neural Tracking HUD' : 'Show Neural Tracking HUD'}
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

      {/* Bottom Floating Action Bar inside Viewport */}
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between z-20 bg-slate-950/90 backdrop-blur-md p-2 rounded-2xl border border-cyan-500/30 text-xs shadow-xl">
        <div className="flex items-center gap-2 text-slate-300 min-w-0 pr-2">
          <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
          <span className="text-[11px] font-medium truncate">
            {cameraActive
              ? telemetry.isPersonTracked
                ? `Rear Sensor • ${telemetry.fps} FPS`
                : 'Pointing Rear Camera at Signer'
              : 'Rear Camera Standby'}
          </span>
        </div>

        <button
          id="btn-toggle-camera"
          onClick={toggleCamera}
          className={`px-3.5 py-1.5 rounded-xl font-bold flex items-center gap-1.5 text-xs transition-all active:scale-95 cursor-pointer shrink-0 ${
            cameraActive
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
          }`}
          aria-label={cameraActive ? 'Turn off rear camera' : 'Start rear camera'}
        >
          {cameraActive ? (
            <>
              <CameraOff className="w-3.5 h-3.5" />
              <span>Stop Camera</span>
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5 fill-current" />
              <span>Start Rear Camera</span>
            </>
          )}
        </button>
      </div>

      {/* Helpful Error Banners */}
      {cameraError && (
        <div className="absolute top-13 inset-x-3 p-3 rounded-2xl bg-rose-950/95 border border-rose-500/50 text-rose-100 text-xs z-30 shadow-xl backdrop-blur-md space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Rear Camera Notice</span>
          </div>
          <p className="text-[11px] leading-relaxed text-rose-200">{cameraError}</p>
          <button
            onClick={() => setCameraError(null)}
            className="text-[10px] text-white underline cursor-pointer pt-1"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
