'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  Sparkles,
  RefreshCw,
  Eye,
  EyeOff,
  ShieldCheck,
  UserCheck,
  UserX,
  Loader2,
  AlertTriangle,
  Info,
  Maximize2,
  Minimize2,
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

  // Camera stream state
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraErrorType, setCameraErrorType] = useState<
    'permission' | 'unavailable' | 'in_use' | 'security' | 'generic' | null
  >(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Neural tracking state
  const [isVisionModelReady, setIsVisionModelReady] = useState<boolean>(false);
  const [modelLoading, setModelLoading] = useState<boolean>(false);
  const [trackingTelemetry, setTrackingTelemetry] = useState<{
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

  // UI display toggles
  const [showNeuralOverlays, setShowNeuralOverlays] = useState<boolean>(true);

  // Dimensions
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Observe container dimensions for canvas matching
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width: Math.round(width), height: Math.round(height) });
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Sync canvas width/height to container
  useEffect(() => {
    if (canvasRef.current && dimensions.width > 0 && dimensions.height > 0) {
      canvasRef.current.width = dimensions.width;
      canvasRef.current.height = dimensions.height;
    }
  }, [dimensions]);

  // Pre-initialize neural vision engine on mount
  useEffect(() => {
    setModelLoading(true);
    neuralVision
      .init()
      .then((ready) => {
        setIsVisionModelReady(ready);
        setModelLoading(false);
      })
      .catch(() => {
        setModelLoading(false);
      });
  }, []);

  // Stop camera tracks cleanly
  const stopCameraStream = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    if (onCameraToggle) onCameraToggle(false);
    if (onPersonDetect) onPersonDetect(false);
  }, [onCameraToggle, onPersonDetect]);

  // Teardown camera on component unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Main Real-Time Tracking & Rendering Loop
  const runVisionRenderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (canvas && dimensions.width > 0 && dimensions.height > 0) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        let frame: TrackingFrame;

        if (cameraActive && video && video.readyState >= 2 && !video.paused && !video.ended) {
          // 1. Live camera frame inference
          frame = neuralVision.processVideoFrame(video, performance.now());

          if (frame.isPersonTracked !== trackingTelemetry.isPersonTracked) {
            if (onPersonDetect) onPersonDetect(frame.isPersonTracked);
          }

          setTrackingTelemetry({
            isPersonTracked: frame.isPersonTracked,
            isSigningActive: frame.isSigningActive,
            headTilt: frame.headTiltAngle,
            fps: frame.fps,
            handsCount: (frame.leftHandLandmarks ? 1 : 0) + (frame.rightHandLandmarks ? 1 : 0),
          });

          if (showNeuralOverlays) {
            neuralVision.renderHUD(
              ctx,
              frame,
              dimensions.width,
              dimensions.height,
              facingMode === 'user'
            );
          } else {
            ctx.clearRect(0, 0, dimensions.width, dimensions.height);
          }
        } else if (isSimulatedDemo || !cameraActive) {
          // 2. High-Fidelity Simulation Mode for Demo / Tour
          frame = neuralVision.generateSimulatedFrame(performance.now());
          if (showNeuralOverlays) {
            neuralVision.renderHUD(ctx, frame, dimensions.width, dimensions.height, false);
          } else {
            ctx.clearRect(0, 0, dimensions.width, dimensions.height);
          }
        } else {
          ctx.clearRect(0, 0, dimensions.width, dimensions.height);
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(runVisionRenderLoop);
  }, [
    cameraActive,
    dimensions,
    facingMode,
    isSimulatedDemo,
    showNeuralOverlays,
    onPersonDetect,
    trackingTelemetry.isPersonTracked,
  ]);

  // Start / restart tracking loop
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(runVisionRenderLoop);
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [runVisionRenderLoop]);

  // Start Camera with user permission
  const startCamera = async (targetFacing: 'user' | 'environment' = facingMode) => {
    setCameraError(null);
    setCameraErrorType(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError('Camera access requires HTTPS or localhost in your browser.');
      setCameraErrorType('security');
      return;
    }

    stopCameraStream();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: targetFacing,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current
              .play()
              .then(() => {
                setCameraActive(true);
                if (onCameraToggle) onCameraToggle(true);
              })
              .catch((err) => {
                setCameraError('Failed to start video playback: ' + err.message);
              });
          }
        };
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera access was denied. Please allow camera permissions in your browser bar.'
        );
        setCameraErrorType('permission');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No video camera was detected on this device.');
        setCameraErrorType('unavailable');
      } else {
        setCameraError('Could not start camera: ' + (err.message || 'Unknown error'));
        setCameraErrorType('generic');
      }
      setCameraActive(false);
      if (onCameraToggle) onCameraToggle(false);
    }
  };

  const toggleCamera = () => {
    if (cameraActive) {
      stopCameraStream();
    } else {
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

  const getStatusBadge = () => {
    if (cameraActive) {
      return (
        <Badge variant={trackingTelemetry.isPersonTracked ? 'emerald' : 'cyan'} size="sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            {trackingTelemetry.isPersonTracked
              ? `Person & Hands Locked (${trackingTelemetry.handsCount > 0 ? `${trackingTelemetry.handsCount} Hands` : 'Tracking'})`
              : 'Scanning Viewport...'}
          </span>
        </Badge>
      );
    }

    if (isSimulatedDemo) {
      return (
        <Badge variant="cyan" size="sm">
          <Sparkles className="w-3 h-3 text-cyan-300 animate-pulse" />
          <span>Neural Vision Simulation</span>
        </Badge>
      );
    }

    return (
      <Badge variant="slate" size="sm">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        <span>Camera Standby</span>
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

      {/* Actual Live Video Element */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          cameraActive ? 'opacity-95' : 'opacity-0 pointer-events-none'
        } ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
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

          <p className="text-sm font-bold text-white">Neural Face & Hand Tracker</p>
          <p className="text-xs text-slate-300 mt-1 max-w-[280px] leading-relaxed">
            Click <strong className="text-cyan-300">Start Camera</strong> below to activate real-time 3D facial mesh, head rotation, and 21-joint hand skeletal tracking.
          </p>

          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-cyan-300/80 bg-slate-900/80 px-2.5 py-1 rounded-full border border-cyan-500/20">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>100% on-device WebGL GPU • Zero video leaves your device</span>
          </div>
        </div>
      )}

      {/* Top HUD Overlay Bar */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between z-20">
        <div className="flex items-center gap-1.5">{getStatusBadge()}</div>

        <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md px-2 py-1 rounded-full border border-cyan-500/30 shadow-lg">
          {/* Toggle landmark overlays */}
          <button
            onClick={() => setShowNeuralOverlays(!showNeuralOverlays)}
            className="p-1.5 rounded-full text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
            title={showNeuralOverlays ? 'Hide Neural Tracking HUD' : 'Show Neural Tracking HUD'}
            aria-label="Toggle Neural Tracking HUD"
          >
            {showNeuralOverlays ? (
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          {/* Flip camera (front / rear) */}
          <button
            onClick={switchFacingMode}
            className="p-1.5 rounded-full text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer flex items-center gap-1"
            title={`Switch to ${facingMode === 'user' ? 'rear' : 'front'} camera`}
            aria-label="Switch camera"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="text-[9px] font-mono uppercase text-slate-400 mr-0.5">
              {facingMode === 'user' ? 'Front' : 'Rear'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Floating Action Bar inside Viewport */}
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between z-20 bg-slate-950/90 backdrop-blur-md p-2 rounded-2xl border border-cyan-500/30 text-xs shadow-xl">
        <div className="flex items-center gap-2 text-slate-300 min-w-0 pr-2">
          <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
          <span className="text-[11px] font-medium truncate">
            {cameraActive
              ? trackingTelemetry.isPersonTracked
                ? `MediaPipe Active • ${trackingTelemetry.fps} FPS`
                : 'Searching for Signer in Frame'
              : 'MediaPipe Vision (WebGL Ready)'}
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
          aria-label={cameraActive ? 'Turn off live camera' : 'Start live camera'}
        >
          {cameraActive ? (
            <>
              <CameraOff className="w-3.5 h-3.5" />
              <span>Stop Camera</span>
            </>
          ) : (
            <>
              <Camera className="w-3.5 h-3.5 fill-current" />
              <span>Start Camera</span>
            </>
          )}
        </button>
      </div>

      {/* Helpful Error Banners */}
      {cameraError && (
        <div className="absolute top-13 inset-x-3 p-3 rounded-2xl bg-rose-950/95 border border-rose-500/50 text-rose-100 text-xs z-30 shadow-xl backdrop-blur-md space-y-1.5">
          <div className="flex items-center gap-1.5 font-bold text-rose-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Camera Notice</span>
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
