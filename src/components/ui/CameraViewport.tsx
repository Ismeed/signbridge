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
  Zap,
  UserCheck,
  UserX,
  Loader2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { InterpretationState } from '@/lib/types';
import { Badge } from './Badge';
import {
  personDetector,
  mapNormalizedBoxToContainer,
  DetectedPerson,
  ScreenBoundingBox,
} from '@/lib/personDetection';
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
  const { preferences } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Camera stream state
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraErrorType, setCameraErrorType] = useState<
    'permission' | 'unavailable' | 'in_use' | 'security' | 'generic' | null
  >(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Person detection state
  const [modelLoading, setModelLoading] = useState<boolean>(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [detectedPerson, setDetectedPerson] = useState<DetectedPerson | null>(null);
  const [screenBox, setScreenBox] = useState<ScreenBoundingBox>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    visible: false,
  });

  // UI display toggles
  const [showDemoOverlays, setShowDemoOverlays] = useState<boolean>(true);

  // Container dimensions for responsive coordinate mapping
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Observe container dimensions for pixel-perfect bounding box projection
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Stop camera tracks cleanly
  const stopCameraStream = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      videoRef.current.srcObject = null;
    }

    personDetector.resetTracking();
    setDetectedPerson(null);
    setScreenBox({ left: 0, top: 0, width: 0, height: 0, visible: false });
    if (onPersonDetect) onPersonDetect(false);
  }, [onPersonDetect]);

  // Teardown camera on component unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Real-time detection animation loop
  const runDetectionLoop = useCallback(() => {
    if (!videoRef.current || !cameraActive) return;

    const video = videoRef.current;
    if (video.readyState >= 2 && !video.paused && !video.ended) {
      const now = performance.now();
      const person = personDetector.detect(video, now);

      if (person) {
        setDetectedPerson(person);
        if (onPersonDetect) onPersonDetect(true);

        const mapped = mapNormalizedBoxToContainer(
          person.box,
          video.videoWidth,
          video.videoHeight,
          dimensions.width,
          dimensions.height,
          facingMode === 'user'
        );
        setScreenBox(mapped);
      } else {
        setDetectedPerson(null);
        setScreenBox((prev) => ({ ...prev, visible: false }));
        if (onPersonDetect) onPersonDetect(false);
      }
    }

    animFrameRef.current = requestAnimationFrame(runDetectionLoop);
  }, [cameraActive, dimensions, facingMode, onPersonDetect]);

  // Start / restart detection loop whenever camera becomes active or dimensions change
  useEffect(() => {
    if (cameraActive) {
      animFrameRef.current = requestAnimationFrame(runDetectionLoop);
    } else {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [cameraActive, runDetectionLoop]);

  // Start Camera with user permission
  const startCamera = async (targetFacing: 'user' | 'environment' = facingMode) => {
    setCameraError(null);
    setCameraErrorType(null);

    // Verify browser mediaDevices capability
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      // Check if insecure context (not localhost or https)
      const isInsecure =
        typeof window !== 'undefined' &&
        window.location.protocol !== 'https:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1';

      if (isInsecure) {
        setCameraError(
          'Camera access requires a secure context (HTTPS or localhost). Please serve this app over HTTPS or on localhost.'
        );
        setCameraErrorType('security');
      } else {
        setCameraError('Camera access is not supported in this browser environment.');
        setCameraErrorType('unavailable');
      }
      return;
    }

    stopCameraStream();

    // Initialize person detector model in background if not already loaded
    if (!personDetector.getIsLoaded() && !personDetector.getIsLoading()) {
      setModelLoading(true);
      setModelError(null);
      personDetector
        .init()
        .then((success) => {
          setModelLoading(false);
          if (!success) {
            setModelError(
              'Person detection model could not be loaded. Camera will stream normally without bounding box overlay.'
            );
          }
        })
        .catch(() => {
          setModelLoading(false);
          setModelError('Offline: Could not load vision model assets.');
        });
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraActive(true);
      if (onCameraToggle) onCameraToggle(true);
    } catch (err: unknown) {
      stopCameraStream();
      setCameraActive(false);
      if (onCameraToggle) onCameraToggle(false);

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError(
            'Camera permission was denied. Please allow camera permissions in your browser address bar or site settings to enable live video and person tracking.'
          );
          setCameraErrorType('permission');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError(
            'No camera hardware detected on this device. You can still interact with phrases using the audio and caption studio.'
          );
          setCameraErrorType('unavailable');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          setCameraError(
            'Camera is currently in use by another tab or application. Please close other camera apps and retry.'
          );
          setCameraErrorType('in_use');
        } else if (err.name === 'SecurityError') {
          setCameraError('Camera access blocked due to security restrictions (requires HTTPS or localhost).');
          setCameraErrorType('security');
        } else {
          setCameraError(`Camera error: ${err.message}`);
          setCameraErrorType('generic');
        }
      } else {
        const msg = err instanceof Error ? err.message : 'Unable to access camera';
        setCameraError(`Camera could not be started: ${msg}`);
        setCameraErrorType('generic');
      }
    }
  };

  const stopCamera = () => {
    stopCameraStream();
    setCameraActive(false);
    if (onCameraToggle) onCameraToggle(false);
  };

  const toggleCamera = () => {
    if (cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  const switchFacingMode = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    if (cameraActive) {
      await startCamera(nextMode);
    }
  };

  // Honest status badge based on genuine camera & person detector states
  const getStatusBadge = () => {
    if (isSimulatedDemo) {
      return (
        <Badge variant="cyan" size="sm">
          <Sparkles className="w-3 h-3 text-cyan-300" />
          <span>Active Sign Sequence</span>
        </Badge>
      );
    }

    if (!cameraActive) {
      return (
        <Badge variant="slate" size="sm">
          <span className="w-2 h-2 rounded-full bg-slate-500" />
          <span>Camera Stopped</span>
        </Badge>
      );
    }

    if (modelLoading) {
      return (
        <Badge variant="amber" size="sm">
          <Loader2 className="w-3 h-3 animate-spin text-amber-300" />
          <span>Loading Vision Model...</span>
        </Badge>
      );
    }

    if (detectedPerson) {
      return (
        <Badge variant="emerald" size="sm">
          <UserCheck className="w-3 h-3 text-emerald-400" />
          <span>Person Detected ({Math.round(detectedPerson.confidence * 100)}%)</span>
        </Badge>
      );
    }

    return (
      <Badge variant="cyan" size="sm">
        <UserX className="w-3 h-3 text-cyan-300 animate-pulse" />
        <span>Searching for Person...</span>
      </Badge>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/5] sm:aspect-[4/3] rounded-3xl overflow-hidden border border-cyan-500/25 bg-[#070e1e] shadow-2xl transition-all"
    >
      {/* Background Matrix Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(6,182,212,0.14),transparent_70%)] pointer-events-none" />
      <div
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(56, 189, 248, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.2) 1px, transparent 1px)',
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

      {/* Dormant Camera Placeholder with Technical Explanation */}
      {!cameraActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="relative w-36 h-40 mb-3 flex items-center justify-center">
            {/* Outer Concentric Radar Ring */}
            <div
              className={`absolute inset-0 rounded-full border border-cyan-500/20 ${
                preferences.reducedMotion ? '' : 'animate-radar'
              }`}
            />
            <div className="absolute inset-4 rounded-full border border-indigo-500/20" />

            {/* Stylized Body Tracking Silhouette Guide */}
            <svg
              viewBox="0 0 160 190"
              className="w-full h-full text-cyan-400/40 drop-shadow-[0_0_15px_rgba(6,182,212,0.3)]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="80" cy="45" r="24" strokeDasharray="3 3" />
              <ellipse cx="80" cy="46" rx="18" ry="22" stroke="currentColor" strokeOpacity="0.8" />
              <path d="M72 44h16" stroke="currentColor" strokeOpacity="0.5" />
              <path
                d="M32 140 C35 98, 55 86, 80 86 C105 86, 125 98, 128 140"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <circle cx="48" cy="116" r="12" stroke="rgba(0,242,254,0.5)" strokeDasharray="2 2" />
              <circle cx="112" cy="116" r="12" stroke="rgba(0,242,254,0.5)" strokeDasharray="2 2" />
            </svg>
          </div>

          <p className="text-sm font-bold text-white">
            {isSimulatedDemo ? 'Gesture Interpretation Viewport' : 'Live Camera Dormant'}
          </p>
          <p className="text-xs text-slate-300 mt-1 max-w-[300px] leading-relaxed">
            {isSimulatedDemo
              ? 'AI sign interpreter ready. Tap "Start Camera" below to activate real-time camera tracking.'
              : 'Tap "Start Camera" below to activate live sign tracking and real-time vision.'}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-cyan-300/80 bg-slate-900/60 px-2.5 py-1 rounded-full border border-cyan-500/20">
            <ShieldCheck className="w-3 h-3 text-cyan-400" />
            <span>Zero video leaves this device • Camera only on explicit consent</span>
          </div>
        </div>
      )}

      {/* GENUINE REAL-TIME PERSON BOUNDING BOX (Follows detected subject) */}
      {cameraActive && detectedPerson && screenBox.visible && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${screenBox.left}px`,
            top: `${screenBox.top}px`,
            width: `${screenBox.width}px`,
            height: `${screenBox.height}px`,
            transition: preferences.reducedMotion
              ? 'none'
              : 'left 80ms ease-out, top 80ms ease-out, width 80ms ease-out, height 80ms ease-out',
          }}
        >
          {/* Main Bounding Frame with restrained cyan glow */}
          <div className="w-full h-full relative rounded-2xl border-2 border-cyan-400/90 shadow-[0_0_20px_rgba(0,242,254,0.4)] bg-cyan-500/5">
            {/* Luminous High-Tech Corner Brackets */}
            <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#00f2fe]" />
            <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#00f2fe]" />
            <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#00f2fe]" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#00f2fe]" />

            {/* Tracking Status Pill (Pinned to top of bounding box) */}
            <div className="absolute -top-7 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950/90 border border-cyan-400/50 shadow-md backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-cyan-200 uppercase tracking-wider">
                PERSON TRACKED • {Math.round(detectedPerson.confidence * 100)}%
              </span>
            </div>

            {/* Status tag below box */}
            <div className="absolute -bottom-5 right-2 px-1.5 py-0.5 rounded bg-slate-950/80 text-[8px] font-mono text-cyan-400 border border-cyan-500/20">
              NSL Tracking Active
            </div>
          </div>
        </div>
      )}

      {/* Global Viewport Corner Reticles (Always visible) */}
      <div className="absolute inset-5 pointer-events-none">
        <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-cyan-400/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-cyan-400/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-cyan-400/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-cyan-400/60" />

        {/* Dynamic Scanning Line (Only while searching for person or active) */}
        {cameraActive && !preferences.reducedMotion && !detectedPerson && (
          <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#00f2fe] animate-scan" />
        )}
      </div>

      {/* Gesture Zone Markers */}
      {showDemoOverlays && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-60">
          <div className="relative w-full h-full">
            {/* Hand Guide Left */}
            <div
              className={`absolute left-[14%] top-[56%] w-14 h-14 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/5 transition-transform ${
                state === 'simulating' || isSimulatedDemo ? 'scale-105' : ''
              }`}
            >
              <span className="absolute -top-3.5 left-1 text-[8px] font-mono text-cyan-300 bg-slate-950/90 px-1 rounded">
                SIGN ZONE L
              </span>
            </div>

            {/* Hand Guide Right */}
            <div
              className={`absolute right-[14%] top-[56%] w-14 h-14 rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/5 transition-transform ${
                state === 'simulating' || isSimulatedDemo ? 'scale-105' : ''
              }`}
            >
              <span className="absolute -top-3.5 left-1 text-[8px] font-mono text-cyan-300 bg-slate-950/90 px-1 rounded">
                SIGN ZONE R
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Top HUD Overlay Bar */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-1.5">{getStatusBadge()}</div>

        <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-full border border-white/10">
          {/* Toggle landmark overlays */}
          <button
            onClick={() => setShowDemoOverlays(!showDemoOverlays)}
            className="p-1.5 rounded-full text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
            title={showDemoOverlays ? 'Hide gesture zones' : 'Show gesture zones'}
            aria-label="Toggle gesture zones"
          >
            {showDemoOverlays ? (
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
            aria-label="Switch front or rear camera"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="text-[9px] font-mono uppercase text-slate-400 mr-0.5">
              {facingMode === 'user' ? 'Front' : 'Rear'}
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Floating Action Bar inside Viewport */}
      <div className="absolute bottom-3 inset-x-3 flex items-center justify-between z-10 bg-slate-950/85 backdrop-blur-md p-2 rounded-2xl border border-white/10 text-xs">
        <div className="flex items-center gap-2 text-slate-300 min-w-0 pr-2">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[11px] font-medium truncate">
            {cameraActive
              ? detectedPerson
                ? 'Subject Tracked (MediaPipe)'
                : 'Searching for Subject'
              : 'Local Device Vision'}
          </span>
        </div>

        <button
          id="btn-toggle-camera"
          onClick={toggleCamera}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 text-xs transition-all active:scale-95 cursor-pointer shrink-0 ${
            cameraActive
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
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
            <span>Camera Access Notice</span>
          </div>
          <p className="text-[11px] leading-relaxed text-rose-200">{cameraError}</p>
          {cameraErrorType === 'permission' && (
            <p className="text-[10px] text-rose-300/80 font-mono">
              Tip: Click the padlock or camera icon in your browser URL bar to grant access.
            </p>
          )}
          {cameraErrorType === 'security' && (
            <p className="text-[10px] text-rose-300/80 font-mono">
              Note: Web browsers restrict camera APIs to HTTPS origins or localhost.
            </p>
          )}
          <button
            onClick={() => setCameraError(null)}
            className="text-[10px] text-white underline cursor-pointer pt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Model Loading Warning Banner if offline */}
      {modelError && cameraActive && (
        <div className="absolute top-13 inset-x-3 p-2.5 rounded-xl bg-amber-950/90 border border-amber-500/40 text-amber-200 text-xs z-25 flex items-start gap-2 backdrop-blur-md">
          <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-tight flex-1">
            <span>{modelError}</span>
            <button
              onClick={() => setModelError(null)}
              className="block text-[10px] text-amber-300 underline mt-1 cursor-pointer"
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
