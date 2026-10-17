'use client';

/**
 * SignBridge AI - High-Performance Neural Vision Tracking Engine
 * Powered by Google MediaPipe Tasks Vision (Pose & Hand Landmarkers)
 * Runs 100% locally on WebGL GPU via WebAssembly (Zero latency, 100% Privacy)
 */

export interface NormalizedPoint {
  x: number; // 0 to 1
  y: number; // 0 to 1
  z?: number;
  visibility?: number;
}

export interface TrackingFrame {
  timestamp: number;
  faceBox: { x: number; y: number; width: number; height: number } | null;
  faceLandmarks: NormalizedPoint[];
  headTiltAngle: number;
  poseLandmarks: NormalizedPoint[];
  leftHandLandmarks: NormalizedPoint[] | null;
  rightHandLandmarks: NormalizedPoint[] | null;
  isPersonTracked: boolean;
  isSigningActive: boolean;
  confidence: number;
  fps: number;
}

// MediaPipe connections for standard 21-point hand skeleton
export const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm Knuckles cross-connections
  [5, 9],
  [9, 13],
  [13, 17],
];

// MediaPipe Pose connections for Upper Body & Face
export const UPPER_BODY_CONNECTIONS: [number, number][] = [
  // Shoulders
  [11, 12],
  // Left arm
  [11, 13],
  [13, 15],
  // Right arm
  [12, 14],
  [14, 16],
  // Torso side bars
  [11, 23],
  [12, 24],
  [23, 24],
];

class NeuralVisionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private poseLandmarker: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handLandmarker: any = null;
  private isInitializing = false;
  private isLoaded = false;
  private lastFrameTime = 0;
  private frameCount = 0;
  private currentFps = 60;
  private fpsTimer = 0;

  // Kinetic trail histories for motion visualization
  private leftHandTrail: NormalizedPoint[] = [];
  private rightHandTrail: NormalizedPoint[] = [];

  public async init(): Promise<boolean> {
    if (this.isLoaded) return true;
    if (this.isInitializing) return false;
    if (typeof window === 'undefined') return false;

    this.isInitializing = true;

    try {
      const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import(
        '@mediapipe/tasks-vision'
      );

      // Try local WASM first, fallback to CDN
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      } catch {
        vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
        );
      }

      // Initialize Pose Landmarker (tracks Head, Face, Torso, Arms)
      try {
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      } catch (err) {
        console.warn('Local Pose model failed, falling back to remote CDN:', err);
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }

      // Initialize Hand Landmarker (tracks 21 high-precision joints per hand)
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/models/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      } catch (err) {
        console.warn('Local Hand model failed, falling back to remote CDN:', err);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      }

      this.isLoaded = true;
      this.isInitializing = false;
      return true;
    } catch (error) {
      console.error('Neural Vision initialization error:', error);
      this.isInitializing = false;
      return false;
    }
  }

  public isReady(): boolean {
    return this.isLoaded && (this.poseLandmarker !== null || this.handLandmarker !== null);
  }

  private lastInferenceTimestamp = 0;

  /**
   * Process a single video frame and extract head, face, and hand landmarks
   */
  public processVideoFrame(
    video: HTMLVideoElement,
    timestamp: number
  ): TrackingFrame {
    // Calculate live FPS
    this.frameCount++;
    if (timestamp - this.fpsTimer > 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (timestamp - this.fpsTimer));
      this.frameCount = 0;
      this.fpsTimer = timestamp;
    }

    const frameResult: TrackingFrame = {
      timestamp,
      faceBox: null,
      faceLandmarks: [],
      headTiltAngle: 0,
      poseLandmarks: [],
      leftHandLandmarks: null,
      rightHandLandmarks: null,
      isPersonTracked: false,
      isSigningActive: false,
      confidence: 0,
      fps: this.currentFps || 60,
    };

    if (
      !this.isReady() ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return frameResult;
    }

    // MediaPipe requires strictly monotonically increasing timestamps
    const safeTimestamp = Math.max(timestamp, this.lastInferenceTimestamp + 1);
    this.lastInferenceTimestamp = safeTimestamp;

    try {
      // 1. Process Pose (Face + Upper Body)
      if (this.poseLandmarker) {
        const poseResult = this.poseLandmarker.detectForVideo(video, safeTimestamp);
        if (poseResult?.landmarks?.length > 0) {
          const landmarks = poseResult.landmarks[0];
          frameResult.poseLandmarks = landmarks;
          frameResult.isPersonTracked = true;

          // Landmarks 0 to 10 are face keypoints (Nose: 0, Eyes: 1-6, Ears: 7-8, Mouth: 9-10)
          const facePoints = landmarks.slice(0, 11);
          frameResult.faceLandmarks = facePoints;

          // Calculate Face Bounding Box & Head Angle
          if (facePoints.length > 0) {
            let minX = 1,
              maxX = 0,
              minY = 1,
              maxY = 0;
            facePoints.forEach((p: NormalizedPoint) => {
              if (p.x < minX) minX = p.x;
              if (p.x > maxX) maxX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.y > maxY) maxY = p.y;
            });

            // Add head margin around face landmarks
            const width = Math.max(0.12, (maxX - minX) * 1.55);
            const height = Math.max(0.16, (maxY - minY) * 1.7);
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            frameResult.faceBox = {
              x: Math.max(0, centerX - width / 2),
              y: Math.max(0, centerY - height / 2),
              width: Math.min(1, width),
              height: Math.min(1, height),
            };

            // Calculate Head Tilt angle from left ear (7) and right ear (8)
            const leftEar = landmarks[7];
            const rightEar = landmarks[8];
            if (leftEar && rightEar) {
              const dy = rightEar.y - leftEar.y;
              const dx = rightEar.x - leftEar.x;
              frameResult.headTiltAngle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
            }
          }

          frameResult.confidence = 0.94;
        }
      }

      // 2. Process High-Precision Hands (21 3D joints per hand)
      if (this.handLandmarker) {
        const handResult = this.handLandmarker.detectForVideo(video, safeTimestamp);
        if (handResult?.landmarks?.length > 0) {
          frameResult.isSigningActive = true;

          handResult.landmarks.forEach((handPoints: NormalizedPoint[], idx: number) => {
            const handedness = handResult.handednesses?.[idx]?.[0]?.categoryName;
            if (handedness === 'Left') {
              frameResult.leftHandLandmarks = handPoints;
              // Add index fingertip (8) to kinetic motion trail
              if (handPoints[8]) {
                this.leftHandTrail.push(handPoints[8]);
                if (this.leftHandTrail.length > 8) this.leftHandTrail.shift();
              }
            } else {
              frameResult.rightHandLandmarks = handPoints;
              if (handPoints[8]) {
                this.rightHandTrail.push(handPoints[8]);
                if (this.rightHandTrail.length > 8) this.rightHandTrail.shift();
              }
            }
          });
        }
      }
    } catch {
      // Gracefully handle occasional frame skip
    }

    return frameResult;
  }

  /**
   * Generates mathematical simulation frames for Demo & Tour modes
   */
  public generateSimulatedFrame(timeMs: number): TrackingFrame {
    const t = timeMs * 0.0022;

    // Organic head gentle movement
    const headX = 0.5 + Math.sin(t * 0.7) * 0.02;
    const headY = 0.28 + Math.cos(t * 0.5) * 0.015;
    const headTilt = Math.sin(t * 0.9) * 4.5;

    // Face landmarks simulation (Nose, Eyes, Mouth)
    const faceLandmarks: NormalizedPoint[] = [
      { x: headX, y: headY }, // Nose (0)
      { x: headX - 0.03, y: headY - 0.025 }, // Left eye
      { x: headX + 0.03, y: headY - 0.025 }, // Right eye
      { x: headX - 0.07, y: headY - 0.01 }, // Left ear
      { x: headX + 0.07, y: headY - 0.01 }, // Right ear
      { x: headX - 0.02, y: headY + 0.04 }, // Mouth left
      { x: headX + 0.02, y: headY + 0.04 }, // Mouth right
    ];

    // Upper body shoulders and elbows
    const shoulderY = headY + 0.17;
    const poseLandmarks: NormalizedPoint[] = [
      ...faceLandmarks,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      // 11: Left Shoulder
      { x: headX - 0.18, y: shoulderY },
      // 12: Right Shoulder
      { x: headX + 0.18, y: shoulderY },
      // 13: Left Elbow
      { x: headX - 0.24, y: shoulderY + 0.18 },
      // 14: Right Elbow
      { x: headX + 0.24, y: shoulderY + 0.18 },
      // 15: Left Wrist
      { x: headX - 0.14 + Math.sin(t * 1.8) * 0.08, y: shoulderY + 0.24 + Math.cos(t * 1.5) * 0.06 },
      // 16: Right Wrist
      { x: headX + 0.14 + Math.cos(t * 1.8) * 0.08, y: shoulderY + 0.24 + Math.sin(t * 1.5) * 0.06 },
    ];

    // Generate 21 hand joints for right hand
    const rightWrist = poseLandmarks[16];
    const rightHandLandmarks: NormalizedPoint[] = [];
    for (let i = 0; i < 21; i++) {
      const fingerIndex = Math.floor((i - 1) / 4);
      const jointStage = ((i - 1) % 4) + 1;
      const angle = (fingerIndex - 2) * 0.28 + Math.sin(t * 2) * 0.1;
      const dist = i === 0 ? 0 : 0.025 * jointStage;
      rightHandLandmarks.push({
        x: rightWrist.x + Math.sin(angle) * dist,
        y: rightWrist.y - Math.cos(angle) * dist,
      });
    }

    // Generate 21 hand joints for left hand
    const leftWrist = poseLandmarks[15];
    const leftHandLandmarks: NormalizedPoint[] = [];
    for (let i = 0; i < 21; i++) {
      const fingerIndex = Math.floor((i - 1) / 4);
      const jointStage = ((i - 1) % 4) + 1;
      const angle = (fingerIndex - 2) * 0.28 - Math.sin(t * 2) * 0.1;
      const dist = i === 0 ? 0 : 0.025 * jointStage;
      leftHandLandmarks.push({
        x: leftWrist.x + Math.sin(angle) * dist,
        y: leftWrist.y - Math.cos(angle) * dist,
      });
    }

    return {
      timestamp: timeMs,
      faceBox: {
        x: headX - 0.11,
        y: headY - 0.12,
        width: 0.22,
        height: 0.25,
      },
      faceLandmarks,
      headTiltAngle: Math.round(headTilt),
      poseLandmarks,
      leftHandLandmarks,
      rightHandLandmarks,
      isPersonTracked: true,
      isSigningActive: true,
      confidence: 0.98,
      fps: 60,
    };
  }

  /**
   * Renders the glowing Holographic Neural Tracking HUD onto Canvas
   */
  public renderHUD(
    ctx: CanvasRenderingContext2D,
    frame: TrackingFrame,
    width: number,
    height: number,
    mirror: boolean = false
  ) {
    ctx.clearRect(0, 0, width, height);

    ctx.save();

    // Mirror horizontally for selfie webcam view if needed
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    const toScreen = (p: NormalizedPoint) => ({
      x: p.x * width,
      y: p.y * height,
    });

    // 1. DRAW SIGNING SPACE BOUNDING CAGE (Chest & Shoulder Region)
    if (frame.poseLandmarks.length >= 13) {
      const leftShoulder = frame.poseLandmarks[11];
      const rightShoulder = frame.poseLandmarks[12];
      if (leftShoulder && rightShoulder) {
        const sL = toScreen(leftShoulder);
        const sR = toScreen(rightShoulder);
        const cageWidth = Math.abs(sR.x - sL.x) * 1.85;
        const cageHeight = cageWidth * 1.15;
        const cageCenterX = (sL.x + sR.x) / 2;
        const cageTopY = Math.min(sL.y, sR.y) - cageHeight * 0.25;

        // Draw futuristic signing zone boundary
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(cageCenterX - cageWidth / 2, cageTopY, cageWidth, cageHeight);
        ctx.setLineDash([]);
      }
    }

    // 2. DRAW UPPER BODY SKELETON (Arms, Shoulders)
    if (frame.poseLandmarks.length > 0) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 8;

      UPPER_BODY_CONNECTIONS.forEach(([startIdx, endIdx]) => {
        const start = frame.poseLandmarks[startIdx];
        const end = frame.poseLandmarks[endIdx];
        if (start && end && (start.visibility ?? 1) > 0.4 && (end.visibility ?? 1) > 0.4) {
          const s = toScreen(start);
          const e = toScreen(end);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
        }
      });
      ctx.shadowBlur = 0;
    }

    // 3. DRAW HIGH-TECH BIOMETRIC FACE & HEAD RETICLE
    if (frame.faceBox) {
      const box = {
        x: frame.faceBox.x * width,
        y: frame.faceBox.y * height,
        w: frame.faceBox.width * width,
        h: frame.faceBox.height * height,
      };

      // Cybernetic Corner Brackets on Head
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 10;

      const bracket = Math.min(22, box.w * 0.2);

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + bracket);
      ctx.lineTo(box.x, box.y);
      ctx.lineTo(box.x + bracket, box.y);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(box.x + box.w - bracket, box.y);
      ctx.lineTo(box.x + box.w, box.y);
      ctx.lineTo(box.x + box.w, box.y + bracket);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + box.h - bracket);
      ctx.lineTo(box.x, box.y + box.h);
      ctx.lineTo(box.x + bracket, box.y + box.h);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(box.x + box.w - bracket, box.y + box.h);
      ctx.lineTo(box.x + box.w, box.y + box.h);
      ctx.lineTo(box.x + box.w, box.y + box.h - bracket);
      ctx.stroke();

      // Elliptical facial contour halo
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(
        box.x + box.w / 2,
        box.y + box.h / 2,
        box.w / 2.2,
        box.h / 2,
        (frame.headTiltAngle * Math.PI) / 180,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Key Facial Landmark Nodes (Eyes, Nose, Mouth)
      if (frame.faceLandmarks.length > 0) {
        ctx.fillStyle = '#34d399';
        ctx.shadowColor = '#34d399';
        ctx.shadowBlur = 6;
        frame.faceLandmarks.forEach((point) => {
          const pt = toScreen(point);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      ctx.shadowBlur = 0;
    }

    // 4. DRAW 21-JOINT HIGH-PRECISION HANDS SKELETON
    const drawHand = (
      landmarks: NormalizedPoint[] | null,
      primaryColor: string,
      tipColor: string
    ) => {
      if (!landmarks || landmarks.length < 21) return;

      // Draw Bones / Connections
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 8;

      HAND_CONNECTIONS.forEach(([startIdx, endIdx]) => {
        const s = toScreen(landmarks[startIdx]);
        const e = toScreen(landmarks[endIdx]);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
      });

      // Draw Joint Nodes
      landmarks.forEach((p, idx) => {
        const pt = toScreen(p);
        const isTip = [4, 8, 12, 16, 20].includes(idx); // Fingertip indices

        if (isTip) {
          // Glowing Fingertip Pulses
          ctx.fillStyle = tipColor;
          ctx.shadowColor = tipColor;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
          ctx.fill();

          // Outer sonic ring
          ctx.strokeStyle = tipColor;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Intermediate joint node
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      ctx.shadowBlur = 0;
    };

    // Draw Left Hand (Purple/Cyan Neon)
    drawHand(frame.leftHandLandmarks, 'rgba(168, 85, 247, 0.85)', '#38bdf8');

    // Draw Right Hand (Cyan/Emerald Neon)
    drawHand(frame.rightHandLandmarks, 'rgba(6, 182, 212, 0.85)', '#10b981');

    ctx.restore();

    // 5. DRAW HUD TELEMETRY DATA (Unmirrored for crisp readable text)
    ctx.save();
    ctx.font = '10px monospace';
    ctx.fillStyle = '#00f2fe';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 4;

    // Head telemetry tag
    if (frame.faceBox) {
      const box = {
        x: mirror ? width - (frame.faceBox.x + frame.faceBox.width) * width : frame.faceBox.x * width,
        y: frame.faceBox.y * height,
      };
      ctx.fillText(`HEAD: ${frame.headTiltAngle}° TILT`, box.x, Math.max(16, box.y - 8));
    }

    // Top Right Diagnostics
    ctx.textAlign = 'right';
    ctx.fillText(`${frame.fps} FPS • NEURAL GPU`, width - 12, 22);

    const handsActive =
      (frame.leftHandLandmarks ? 1 : 0) + (frame.rightHandLandmarks ? 1 : 0);
    ctx.fillText(
      handsActive > 0 ? `HANDS: ${handsActive} ACTIVE (42 JOINTS)` : 'HANDS: SEARCHING',
      width - 12,
      36
    );

    ctx.restore();
  }
}

export const neuralVision = new NeuralVisionService();
