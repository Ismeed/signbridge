'use client';

/**
 * SignBridge AI - Real-Time In-Browser Person Detection Engine
 * Uses MediaPipe Tasks Vision ObjectDetector with EfficientDet-Lite
 * 
 * IMPORTANT HONESTY NOTE:
 * Person detection detects human body presence and position.
 * It is NOT Nigerian Sign Language recognition.
 */

export interface NormalizedBoundingBox {
  originX: number; // 0 to 1 relative to video width
  originY: number; // 0 to 1 relative to video height
  width: number;   // 0 to 1 relative to video width
  height: number;  // 0 to 1 relative to video height
}

export interface DetectedPerson {
  box: NormalizedBoundingBox;
  confidence: number;
  label: string;
  category: string;
}

export interface ScreenBoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

export type DetectorState =
  | 'idle'             // Camera off
  | 'loading_model'    // Loading WASM and model
  | 'searching'        // Camera active, looking for a person
  | 'detected'         // Live person detected
  | 'error'            // Model or inference error
  | 'offline';         // Network unavailable for remote model

// Fallback Google Storage CDN model path (EfficientDet-Lite0 ~4.4MB)
const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

// Local wasm path (copied to public/mediapipe/wasm)
const LOCAL_WASM_PATH = '/mediapipe/wasm';
const CDN_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';

class PersonDetectorService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private detector: any = null;
  private isLoading = false;
  private loadError: string | null = null;
  private lastInferenceTime = 0;
  private isProcessing = false;
  private smoothedBox: NormalizedBoundingBox | null = null;
  private lastDetectedPerson: DetectedPerson | null = null;
  private consecutiveEmptyFrames = 0;

  /**
   * Initialize MediaPipe ObjectDetector dynamically in browser
   */
  public async init(): Promise<boolean> {
    if (this.detector) return true;
    if (typeof window === 'undefined') return false;
    if (this.isLoading) return false;

    this.isLoading = true;
    this.loadError = null;

    try {
      // Dynamic import to avoid SSR issues
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');

      // Try local WASM path first, fallback to CDN
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
      } catch {
        vision = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
      }

      // Initialize ObjectDetector specifically allowlisting 'person'
      this.detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: REMOTE_MODEL_URL,
        },
        scoreThreshold: 0.3,
        categoryAllowlist: ['person'],
        runningMode: 'VIDEO',
      });

      this.isLoading = false;
      return true;
    } catch (err: unknown) {
      this.isLoading = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.loadError = msg;
      return false;
    }
  }

  public getIsLoaded(): boolean {
    return !!this.detector;
  }

  public getIsLoading(): boolean {
    return this.isLoading;
  }

  public getLoadError(): string | null {
    return this.loadError;
  }

  /**
   * Run inference on the current video frame
   */
  public detect(video: HTMLVideoElement, timestampMs: number): DetectedPerson | null {
    if (!this.detector || !video || video.readyState < 2) {
      return null;
    }

    if (this.isProcessing) {
      return this.lastDetectedPerson;
    }

    // Throttle inference to ~25fps (40ms) to ensure smooth battery & CPU performance
    if (timestampMs - this.lastInferenceTime < 40) {
      return this.lastDetectedPerson;
    }

    this.isProcessing = true;
    this.lastInferenceTime = timestampMs;

    try {
      const result = this.detector.detectForVideo(video, timestampMs);
      const detections = result.detections || [];

      // Filter and score person detections
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const personDetections = detections.filter((d: any) => {
        const cat = d.categories?.[0];
        return cat && cat.categoryName === 'person' && cat.score >= 0.3;
      });

      if (personDetections.length === 0) {
        this.consecutiveEmptyFrames++;
        // Maintain smooth box for a couple frames to prevent flickering
        if (this.consecutiveEmptyFrames > 3) {
          this.smoothedBox = null;
          this.lastDetectedPerson = null;
        }
        this.isProcessing = false;
        return this.lastDetectedPerson;
      }

      this.consecutiveEmptyFrames = 0;

      // Select the primary subject: prefer larger bounding boxes close to frame center
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bestDetection: any = null;
      let highestScore = -1;

      const vidW = video.videoWidth || 1;
      const vidH = video.videoHeight || 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const d of personDetections) {
        const bbox = d.boundingBox;
        if (!bbox) continue;

        const normW = bbox.width / vidW;
        const normH = bbox.height / vidH;
        const normX = bbox.originX / vidW;
        const normY = bbox.originY / vidH;

        const area = normW * normH;
        const centerX = normX + normW / 2;
        const centerY = normY + normH / 2;
        const distFromCenter = Math.hypot(centerX - 0.5, centerY - 0.5);

        // Score formula: Area with centrality bonus
        const score = area * (1.2 - 0.4 * distFromCenter) * (d.categories[0].score || 0.5);

        if (score > highestScore) {
          highestScore = score;
          bestDetection = d;
        }
      }

      if (!bestDetection || !bestDetection.boundingBox) {
        this.isProcessing = false;
        return null;
      }

      const bbox = bestDetection.boundingBox;
      const rawBox: NormalizedBoundingBox = {
        originX: Math.max(0, Math.min(1, bbox.originX / vidW)),
        originY: Math.max(0, Math.min(1, bbox.originY / vidH)),
        width: Math.max(0.05, Math.min(1, bbox.width / vidW)),
        height: Math.max(0.05, Math.min(1, bbox.height / vidH)),
      };

      // Exponential moving average smoothing (alpha = 0.45) for natural motion tracking
      if (!this.smoothedBox) {
        this.smoothedBox = rawBox;
      } else {
        const alpha = 0.45;
        this.smoothedBox = {
          originX: this.smoothedBox.originX + alpha * (rawBox.originX - this.smoothedBox.originX),
          originY: this.smoothedBox.originY + alpha * (rawBox.originY - this.smoothedBox.originY),
          width: this.smoothedBox.width + alpha * (rawBox.width - this.smoothedBox.width),
          height: this.smoothedBox.height + alpha * (rawBox.height - this.smoothedBox.height),
        };
      }

      const detected: DetectedPerson = {
        box: this.smoothedBox,
        confidence: bestDetection.categories[0].score || 0.5,
        label: 'Person Detected',
        category: 'person',
      };

      this.lastDetectedPerson = detected;
      this.isProcessing = false;
      return detected;
    } catch {
      this.isProcessing = false;
      return this.lastDetectedPerson;
    }
  }

  public resetTracking(): void {
    this.smoothedBox = null;
    this.lastDetectedPerson = null;
    this.consecutiveEmptyFrames = 0;
  }

  public dispose(): void {
    if (this.detector && typeof this.detector.close === 'function') {
      try {
        this.detector.close();
      } catch {
        // Ignore dispose error
      }
    }
    this.detector = null;
    this.resetTracking();
  }
}

// Singleton detector instance across component re-renders
export const personDetector = new PersonDetectorService();

/**
 * Mathematically transforms normalized video bounding box to viewport container space
 * Properly accounts for:
 * 1. object-fit: cover scaling & cropping offsets
 * 2. Mirroring when using front camera (scale-x-[-1])
 * 3. Viewport resizing
 */
export function mapNormalizedBoxToContainer(
  box: NormalizedBoundingBox | null,
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number,
  isMirrored: boolean
): ScreenBoundingBox {
  if (!box || !videoWidth || !videoHeight || !containerWidth || !containerHeight) {
    return { left: 0, top: 0, width: 0, height: 0, visible: false };
  }

  // Calculate object-fit: cover scale and offsets
  const scale = Math.max(containerWidth / videoWidth, containerHeight / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;

  // Since object-fit: cover centers the content (50% 50% default):
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  // Handle horizontal coordinate mirroring for front camera
  let normX = box.originX;
  if (isMirrored) {
    normX = 1 - (box.originX + box.width);
  }

  const left = offsetX + normX * renderedWidth;
  const top = offsetY + box.originY * renderedHeight;
  const width = box.width * renderedWidth;
  const height = box.height * renderedHeight;

  return {
    left,
    top,
    width,
    height,
    visible: true,
  };
}
