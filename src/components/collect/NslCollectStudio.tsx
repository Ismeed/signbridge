'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Cloud,
  CloudUpload,
  Cpu,
  Download,
  Hand,
  KeyRound,
  Plus,
  RefreshCw,
  Share2,
  Square,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { CameraViewport } from '@/components/ui/CameraViewport';
import type { TrackingFrame } from '@/lib/neuralVision';
import {
  evaluateSequenceQuality,
  extractNslFrameFeatures,
  NSL_MIN_RAW_FRAMES,
  NSL_SEQUENCE_LENGTH,
  resampleNslSequence,
  type NslFrameFeatures,
} from '@/lib/nslFeatures';
import {
  addCustomNslLabel,
  clearNslDataset,
  countSamplesByLabel,
  deleteNslSample,
  getAllNslLabels,
  loadNslSamples,
  loadSavedSignerTag,
  mergeImportedDataset,
  normalizeSignerTag,
  parseImportedDatasetJson,
  saveNslSample,
  saveSignerTag,
  serializeDatasetJson,
  slugifyLabel,
  type NslLabelDefinition,
  type NslRecordedSample,
} from '@/lib/nslDataset';
import {
  clearTrainedModel,
  loadTrainedModel,
  parseImportedModelJson,
  saveTrainedModel,
  serializeModelJson,
  trainNslModel,
  type NslTrainedModel,
} from '@/lib/nslModel';
import { signClassifier } from '@/lib/signClassifier';
import { triggerHaptic } from '@/lib/speech';
import { useApp } from '@/context/AppContext';

export interface NslCollectStudioProps {
  standalone?: boolean;
}

type CapturePhase = 'idle' | 'countdown' | 'recording';

interface StatusBanner {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface CloudSummaryState {
  cloudConfigured: boolean;
  collectPasscodeRequired: boolean;
  adminPasscodeRequired: boolean;
  totalSamples: number;
  signersCount: number;
  labelsSummary: Array<{ id: string; name: string; count: number }>;
}

const COUNTDOWN_SECONDS = 2;
const DEFAULT_CAPTURE_DURATION_MS = 3000;
const CAPTURE_DURATION_OPTIONS = [2000, 3000, 4000] as const;
const MAX_FRAME_EXTENSION_MS = 2500;
const MAX_CLOUD_BATCH = 25;
const NSL_SYNCED_IDS_KEY = 'signbridge_nsl_synced_ids_v1';

function loadSyncedSampleIds(): Set<string> {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return new Set<string>();
  }
  try {
    const raw = window.localStorage.getItem(NSL_SYNCED_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set<string>();
  }
}

function saveSyncedSampleIds(ids: Set<string>): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(NSL_SYNCED_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore storage quota errors cleanly.
  }
}

export function NslCollectStudio({ standalone = false }: NslCollectStudioProps) {
  const { preferences } = useApp();

  const [labels, setLabels] = useState<NslLabelDefinition[]>(() => getAllNslLabels());
  const [samples, setSamples] = useState<NslRecordedSample[]>(() => loadNslSamples());
  const [syncedIds, setSyncedIds] = useState<Set<string>>(() => loadSyncedSampleIds());
  const [signerInput, setSignerInput] = useState<string>(() => loadSavedSignerTag() ?? String());
  const [accessCode, setAccessCode] = useState<string>(() => String());
  const [cloudSummary, setCloudSummary] = useState<CloudSummaryState | null>(null);
  const [cloudBusy, setCloudBusy] = useState<'idle' | 'syncing' | 'pulling' | 'refreshing'>('idle');

  const [selectedLabelId, setSelectedLabelId] = useState<string>('greeting');
  const [showAddLabel, setShowAddLabel] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [trackerReady, setTrackerReady] = useState<boolean>(false);
  const [captureDurationMs, setCaptureDurationMs] = useState<number>(DEFAULT_CAPTURE_DURATION_MS);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [captureExtending, setCaptureExtending] = useState<boolean>(false);
  const [countdownLeft, setCountdownLeft] = useState<number>(COUNTDOWN_SECONDS);
  const [capturedFramesCount, setCapturedFramesCount] = useState<number>(0);
  const [handsVisibleLive, setHandsVisibleLive] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [trainedModel, setTrainedModel] = useState<NslTrainedModel | null>(() => loadTrainedModel());
  const [statusBanner, setStatusBanner] = useState<StatusBanner | null>(null);

  const customInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelFileInputRef = useRef<HTMLInputElement>(null);

  const isRecordingRef = useRef<boolean>(false);
  const rawFeaturesRef = useRef<NslFrameFeatures[]>([]);
  const rawVectorsRef = useRef<number[][]>([]);
  const prevFrameRef = useRef<TrackingFrame | null>(null);
  const recordStartPerfRef = useRef<number>(0);
  const captureDurationMsRef = useRef<number>(captureDurationMs);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const signerInputRef = useRef<string>(signerInput);
  const selectedLabelRef = useRef<{ id: string; name: string }>({
    id: 'greeting',
    name: 'Greeting & Peace',
  });

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const extendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedLabel = useMemo(
    () => labels.find((item) => item.id === selectedLabelId) ?? labels[0],
    [labels, selectedLabelId]
  );

  useEffect(() => {
    if (selectedLabel) {
      selectedLabelRef.current = { id: selectedLabel.id, name: selectedLabel.name };
    }
  }, [selectedLabel]);

  useEffect(() => {
    signerInputRef.current = signerInput;
  }, [signerInput]);

  useEffect(() => {
    captureDurationMsRef.current = captureDurationMs;
  }, [captureDurationMs]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/nsl/samples?mode=summary', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as CloudSummaryState;
        if (!cancelled) {
          setCloudSummary(data);
        }
      })
      .catch(() => {
        // Offline mode: local capture and JSON export remain functional.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCloudSummary = useCallback(async () => {
    setCloudBusy('refreshing');
    try {
      const res = await fetch('/api/nsl/samples?mode=summary', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as CloudSummaryState;
      setCloudSummary(data);
    } catch {
      // Ignore transient network errors cleanly.
    } finally {
      setCloudBusy('idle');
    }
  }, []);

  const clearActiveTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (extendTimerRef.current) {
      clearInterval(extendTimerRef.current);
      extendTimerRef.current = null;
    }
  }, []);

  const resetCaptureState = useCallback(() => {
    clearActiveTimers();
    isRecordingRef.current = false;
    rawFeaturesRef.current = [];
    rawVectorsRef.current = [];
    prevFrameRef.current = null;
    setCaptureExtending(false);
    setCapturePhase('idle');
    setCapturedFramesCount(0);
  }, [clearActiveTimers]);

  useEffect(() => {
    return () => {
      clearActiveTimers();
      isRecordingRef.current = false;
    };
  }, [clearActiveTimers]);

  const finishRecording = useCallback(() => {
    clearActiveTimers();
    if (!isRecordingRef.current) {
      setCapturePhase('idle');
      return;
    }

    isRecordingRef.current = false;
    setCaptureExtending(false);
    setCapturePhase('idle');

    const capturedFeatures = rawFeaturesRef.current;
    const capturedVectors = rawVectorsRef.current;
    const durationMs = Math.max(0, performance.now() - recordStartPerfRef.current);

    rawFeaturesRef.current = [];
    rawVectorsRef.current = [];
    prevFrameRef.current = null;
    setCapturedFramesCount(0);

    const quality = evaluateSequenceQuality(capturedFeatures, durationMs);
    if (!quality.isUsable) {
      const handPct = Math.round(quality.handCoverageRatio * 100);
      const secLabel = (durationMs / 1000).toFixed(1);
      setStatusBanner({
        tone: 'error',
        message:
          quality.rawFrameCount < NSL_MIN_RAW_FRAMES
            ? `Only ${quality.rawFrameCount} tracked frames captured in ${secLabel}s (${quality.fpsEstimate} FPS, need ${NSL_MIN_RAW_FRAMES}+). Use bright lighting, wait for landmarks, or choose 4s clip length.`
            : `Low hand visibility (${handPct}% across ${quality.rawFrameCount} frames). Keep signing hands in frame.`,
      });
      return;
    }

    const resampled = resampleNslSequence(capturedVectors, NSL_SEQUENCE_LENGTH);
    const activeLabel = selectedLabelRef.current;
    const currentSigner = signerInputRef.current.trim();
    const result = saveNslSample({
      labelId: activeLabel.id,
      labelName: activeLabel.name,
      signerTag: currentSigner.length > 0 ? currentSigner : undefined,
      sequence: resampled,
      quality,
      cameraFacing: facingModeRef.current,
    });

    if (!result.ok) {
      setStatusBanner({ tone: 'error', message: result.error });
      return;
    }

    setSamples(result.samples);
    triggerHaptic('heavy', preferences.hapticsEnabled);

    const coveragePct = Math.round(quality.handCoverageRatio * 100);
    setStatusBanner({
      tone: 'success',
      message: `Saved "${activeLabel.name}" (${quality.rawFrameCount}f -> ${NSL_SEQUENCE_LENGTH}x${resampled[0].length}, ${coveragePct}% hands).`,
    });
  }, [clearActiveTimers, preferences.hapticsEnabled]);

  const beginRecordingWindow = useCallback(() => {
    const targetDurationMs = captureDurationMsRef.current;
    rawFeaturesRef.current = [];
    rawVectorsRef.current = [];
    prevFrameRef.current = null;
    recordStartPerfRef.current = performance.now();
    isRecordingRef.current = true;
    setCaptureExtending(false);
    setCapturePhase('recording');
    setCapturedFramesCount(0);
    triggerHaptic('medium', preferences.hapticsEnabled);

    progressTimerRef.current = setInterval(() => {
      setCapturedFramesCount(rawVectorsRef.current.length);
    }, 100);

    finishTimerRef.current = setTimeout(() => {
      if (rawFeaturesRef.current.length >= NSL_MIN_RAW_FRAMES) {
        finishRecording();
        return;
      }
      setCaptureExtending(true);
      const maxDeadline = recordStartPerfRef.current + targetDurationMs + MAX_FRAME_EXTENSION_MS;
      extendTimerRef.current = setInterval(() => {
        setCapturedFramesCount(rawVectorsRef.current.length);
        if (
          rawFeaturesRef.current.length >= NSL_MIN_RAW_FRAMES ||
          performance.now() >= maxDeadline
        ) {
          finishRecording();
        }
      }, 100);
    }, targetDurationMs);
  }, [finishRecording, preferences.hapticsEnabled]);

  const handleStartCapture = () => {
    if (!cameraActive) {
      setStatusBanner({
        tone: 'info',
        message: 'Tap "Start Camera" on the preview first, then capture.',
      });
      return;
    }
    if (capturePhase !== 'idle') {
      resetCaptureState();
      setStatusBanner({ tone: 'info', message: 'Capture cancelled.' });
      return;
    }
    if (!trackerReady) {
      setStatusBanner({
        tone: 'info',
        message:
          'AI hand & body tracker is still warming up (first load takes a few seconds). Wait for "Scanning" or green hand joints, then tap Record.',
      });
      return;
    }

    setStatusBanner(null);
    setConfirmClear(false);
    setCapturePhase('countdown');
    setCountdownLeft(COUNTDOWN_SECONDS);
    triggerHaptic('light', preferences.hapticsEnabled);

    let remaining = COUNTDOWN_SECONDS;
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        beginRecordingWindow();
      } else {
        setCountdownLeft(remaining);
      }
    }, 1000);
  };

  const handleCameraToggle = useCallback(
    (active: boolean) => {
      setCameraActive(active);
      if (!active) {
        setHandsVisibleLive(false);
        if (isRecordingRef.current || countdownTimerRef.current) {
          resetCaptureState();
        }
      }
    },
    [resetCaptureState]
  );

  const handleTrackingFrame = useCallback(
    (frame: TrackingFrame, facingMode: 'user' | 'environment') => {
      facingModeRef.current = facingMode;
      const hasHandsNow = Boolean(frame.leftHandLandmarks || frame.rightHandLandmarks);
      setHandsVisibleLive((prev) => (prev === hasHandsNow ? prev : hasHandsNow));

      if (!isRecordingRef.current) return;

      const extracted = extractNslFrameFeatures(frame, prevFrameRef.current);
      prevFrameRef.current = frame;
      rawFeaturesRef.current.push(extracted);
      rawVectorsRef.current.push(extracted.vector);
    },
    []
  );

  const handleSignerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSignerInput(val);
    saveSignerTag(val);
  };

  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const rawValue = customInputRef.current?.value ?? String();
    const added = addCustomNslLabel(rawValue, 'Custom');
    if (!added) {
      setStatusBanner({
        tone: 'error',
        message: 'Enter at least 2 characters for a custom NSL sign label.',
      });
      return;
    }
    setLabels(getAllNslLabels());
    setSelectedLabelId(added.id);
    setShowAddLabel(false);
    if (customInputRef.current) {
      customInputRef.current.value = String();
    }
    setStatusBanner({ tone: 'success', message: `Selected sign "${added.name}".` });
  };

  const handleDeleteSample = (id: string) => {
    const updated = deleteNslSample(id);
    setSamples(updated);
    if (syncedIds.has(id)) {
      const next = new Set(syncedIds);
      next.delete(id);
      setSyncedIds(next);
      saveSyncedSampleIds(next);
    }
  };

  const handleClearDataset = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearNslDataset();
    setSamples([]);
    setConfirmClear(false);
    const emptySet = new Set<string>();
    setSyncedIds(emptySet);
    saveSyncedSampleIds(emptySet);
    setStatusBanner({ tone: 'info', message: 'All local NSL clips cleared from this browser.' });
  };

  const triggerJsonDownload = (filename: string, jsonContent: string) => {
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleShareOrExportJson = async () => {
    if (samples.length === 0) return;
    const dateStamp = new Date().toISOString().slice(0, 10);
    const signerSlug = slugifyLabel(signerInput.trim().length > 0 ? signerInput : 'contributor');
    const filename = `signbridge-nsl-${signerSlug}-${dateStamp}.json`;
    const jsonContent = serializeDatasetJson(samples, labels);

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        const file = new File([jsonContent], filename, { type: 'application/json' });
        const canShareFile =
          typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : true;
        if (canShareFile) {
          await navigator.share({
            files: [file],
            title: 'SignBridge NSL Clips',
            text: `${samples.length} NSL clips from ${normalizeSignerTag(signerInput)}`,
          });
          setStatusBanner({
            tone: 'success',
            message: `Shared ${samples.length} NSL clip(s) as ${filename}.`,
          });
          return;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
      }
    }

    triggerJsonDownload(filename, jsonContent);
    setStatusBanner({
      tone: 'success',
      message: `Exported ${samples.length} labeled NSL clip(s) as JSON.`,
    });
  };

  const unsyncedSamples = useMemo(
    () => samples.filter((sample) => !syncedIds.has(sample.id)),
    [samples, syncedIds]
  );

  const handleSubmitToCloud = async () => {
    if (unsyncedSamples.length === 0 || cloudBusy !== 'idle') return;

    const cleanedSigner = signerInput.trim();
    if (cleanedSigner.length < 2) {
      setStatusBanner({
        tone: 'error',
        message:
          'Enter your Contributor Name (2+ characters) above before uploading clips to the team database.',
      });
      return;
    }

    if (cloudSummary?.collectPasscodeRequired && accessCode.trim().length === 0) {
      setStatusBanner({
        tone: 'error',
        message: 'Enter the Team Access Code to upload clips to the shared team database.',
      });
      return;
    }

    const normalizedSigner = normalizeSignerTag(cleanedSigner);
    saveSignerTag(normalizedSigner);
    setCloudBusy('syncing');

    const updatedSynced = new Set(syncedIds);
    let totalUploaded = 0;

    try {
      for (let i = 0; i < unsyncedSamples.length; i += MAX_CLOUD_BATCH) {
        const batch = unsyncedSamples.slice(i, i + MAX_CLOUD_BATCH).map((sample) => ({
          ...sample,
          signerTag:
            sample.signerTag && sample.signerTag !== 'local-signer'
              ? sample.signerTag
              : normalizedSigner,
        }));

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (accessCode.trim().length > 0) {
          headers['x-nsl-passcode'] = accessCode.trim();
        }

        const res = await fetch('/api/nsl/samples', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            signerTag: normalizedSigner,
            samples: batch,
          }),
        });

        const payload = (await res.json()) as {
          error?: string;
          totalCloudCount?: number;
          signersCount?: number;
        };

        if (!res.ok) {
          setStatusBanner({
            tone: 'error',
            message: payload.error ?? `Upload failed with HTTP ${res.status}.`,
          });
          setSyncedIds(updatedSynced);
          saveSyncedSampleIds(updatedSynced);
          setCloudBusy('idle');
          return;
        }

        for (const item of batch) {
          updatedSynced.add(item.id);
        }
        totalUploaded += batch.length;
        saveSyncedSampleIds(updatedSynced);
      }

      setSyncedIds(updatedSynced);
      triggerHaptic('heavy', preferences.hapticsEnabled);
      await refreshCloudSummary();
      setStatusBanner({
        tone: 'success',
        message: `Uploaded ${totalUploaded} clip(s) as "${normalizedSigner}" to the team dataset.`,
      });
    } catch {
      setSyncedIds(updatedSynced);
      saveSyncedSampleIds(updatedSynced);
      setStatusBanner({
        tone: 'error',
        message: 'Network error while uploading. Clips remain safely queued locally.',
      });
    } finally {
      setCloudBusy('idle');
    }
  };

  const handlePullTeamAndTrain = async () => {
    if (cloudBusy !== 'idle') return;
    if (cloudSummary?.adminPasscodeRequired && accessCode.trim().length === 0) {
      setStatusBanner({
        tone: 'error',
        message: 'Enter the Team Lead passcode in Access Code to pull the full team dataset.',
      });
      return;
    }

    setCloudBusy('pulling');
    try {
      const headers: Record<string, string> = {};
      if (accessCode.trim().length > 0) {
        headers['x-nsl-passcode'] = accessCode.trim();
      }

      const res = await fetch('/api/nsl/samples?mode=export', {
        headers,
        cache: 'no-store',
      });

      const rawText = await res.text();
      if (!res.ok) {
        let errMessage = `Team dataset pull failed (HTTP ${res.status}).`;
        try {
          const parsedErr = JSON.parse(rawText) as { error?: string };
          if (parsedErr.error) errMessage = parsedErr.error;
        } catch {
          // Keep HTTP fallback message.
        }
        setStatusBanner({ tone: 'error', message: errMessage });
        return;
      }

      const parsed = parseImportedDatasetJson(rawText);
      if (!parsed.ok) {
        setStatusBanner({ tone: 'error', message: parsed.error });
        return;
      }

      const combinedById = new Map<string, NslRecordedSample>();
      for (const sample of parsed.dataset.samples) {
        combinedById.set(sample.id, sample);
      }
      for (const localSample of samples) {
        if (!combinedById.has(localSample.id)) {
          combinedById.set(localSample.id, localSample);
        }
      }

      const combinedSamples = Array.from(combinedById.values());
      const trained = trainNslModel(combinedSamples);
      if (!trained.ok) {
        setStatusBanner({ tone: 'error', message: trained.error });
        return;
      }

      const saved = saveTrainedModel(trained.model);
      if (!saved.ok) {
        setStatusBanner({ tone: 'error', message: saved.error });
        return;
      }

      signClassifier.setModel(trained.model);
      setTrainedModel(trained.model);
      triggerHaptic('heavy', preferences.hapticsEnabled);

      const valPct = Math.round(trained.model.metrics.valAccuracy * 100);
      const splitLabel =
        trained.model.metrics.splitStrategy === 'signer-grouped'
          ? 'unseen-signer val'
          : 'clip-split val';
      setStatusBanner({
        tone: 'success',
        message: `Trained team model on ${combinedSamples.length} clips across ${trained.model.classes.length} signs (${valPct}% ${splitLabel}).`,
      });
    } catch {
      setStatusBanner({
        tone: 'error',
        message: 'Failed fetching or training on team dataset.',
      });
    } finally {
      setCloudBusy('idle');
    }
  };

  const handleTrainLocalModel = () => {
    const result = trainNslModel(samples);
    if (!result.ok) {
      setStatusBanner({ tone: 'error', message: result.error });
      return;
    }
    const saved = saveTrainedModel(result.model);
    if (!saved.ok) {
      setStatusBanner({ tone: 'error', message: saved.error });
      return;
    }
    signClassifier.setModel(result.model);
    setTrainedModel(result.model);
    triggerHaptic('heavy', preferences.hapticsEnabled);
    const valPct = Math.round(result.model.metrics.valAccuracy * 100);
    const trainPct = Math.round(result.model.metrics.trainAccuracy * 100);
    setStatusBanner({
      tone: 'success',
      message: `Trained local model on ${result.model.classes.length} signs (Val ${valPct}%, Train ${trainPct}%).`,
    });
  };

  const handleExportModelJson = () => {
    if (!trainedModel) return;
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerJsonDownload(`signbridge-nsl-model-${dateStamp}.json`, serializeModelJson(trainedModel));
    setStatusBanner({
      tone: 'success',
      message: `Exported NSL model weights (${trainedModel.classes.length} signs).`,
    });
  };

  const handleImportModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = String();
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseImportedModelJson(text);
      if (!parsed.ok) {
        setStatusBanner({ tone: 'error', message: parsed.error });
        return;
      }
      const saved = saveTrainedModel(parsed.model);
      if (!saved.ok) {
        setStatusBanner({ tone: 'error', message: saved.error });
        return;
      }
      signClassifier.setModel(parsed.model);
      setTrainedModel(parsed.model);
      setStatusBanner({
        tone: 'success',
        message: `Loaded NSL model covering ${parsed.model.classes.length} signs.`,
      });
    } catch {
      setStatusBanner({ tone: 'error', message: 'Failed to read selected model JSON file.' });
    }
  };

  const handleClearModel = () => {
    clearTrainedModel();
    signClassifier.setModel(null);
    setTrainedModel(null);
    setStatusBanner({ tone: 'info', message: 'Cleared browser NSL model weights.' });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = String();
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseImportedDatasetJson(text);
      if (!parsed.ok) {
        setStatusBanner({ tone: 'error', message: parsed.error });
        return;
      }
      const merged = mergeImportedDataset(parsed.dataset);
      if (!merged.ok) {
        setStatusBanner({ tone: 'error', message: merged.error });
        return;
      }
      setSamples(merged.samples);
      setLabels(merged.labels);
      setStatusBanner({
        tone: 'success',
        message: `Imported ${merged.addedCount} new clip(s) (${merged.totalCount} total local).`,
      });
    } catch {
      setStatusBanner({ tone: 'error', message: 'Failed to read selected JSON file.' });
    }
  };

  const countsByLabel = useMemo(() => countSamplesByLabel(samples), [samples]);
  const cloudCountByLabel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cloudSummary?.labelsSummary ?? []) {
      map[item.id] = item.count;
    }
    return map;
  }, [cloudSummary]);

  const coveredLabelsCount = useMemo(
    () => labels.filter((label) => (countsByLabel[label.id] ?? 0) > 0).length,
    [labels, countsByLabel]
  );
  const trainableClassesCount = useMemo(
    () => Object.values(countsByLabel).filter((count) => count >= 2).length,
    [countsByLabel]
  );

  const cloudConfigured = cloudSummary?.cloudConfigured ?? false;
  const showPasscodeField =
    cloudConfigured &&
    ((cloudSummary?.collectPasscodeRequired ?? false) ||
      (cloudSummary?.adminPasscodeRequired ?? false));

  return (
    <div className="min-h-dvh bg-[#060913] text-slate-100">
      <div className="max-w-lg mx-auto w-full px-4 py-5 pb-14 space-y-4">
        {/* Studio Header */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                Team Collector
              </span>
              {cloudConfigured && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-semibold text-emerald-300">
                  <Cloud className="w-3 h-3" />
                  <span>Cloud Connected</span>
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-xl font-extrabold text-white tracking-tight">
              SignBridge NSL Data Studio
            </h1>
            <p className="text-xs text-slate-400">
              {samples.length} local clip(s) • {coveredLabelsCount}/{labels.length} signs recorded
            </p>
          </div>

          {!standalone && (
            <Link
              href="/"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-semibold text-slate-200 hover:bg-white/[0.12] transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>App</span>
            </Link>
          )}
        </header>

        {/* Contributor Identity & Shared Team Sync Bar */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Contributor & Team Sync
              </span>
            </div>
            {cloudConfigured && (
              <button
                onClick={refreshCloudSummary}
                disabled={cloudBusy !== 'idle'}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 cursor-pointer"
                aria-label="Refresh team database summary"
              >
                <RefreshCw className={clsx('w-3 h-3', cloudBusy === 'refreshing' && 'animate-spin')} />
                <span>Refresh</span>
              </button>
            )}
          </div>

          <div
            className={clsx(
              'grid gap-2 items-end',
              showPasscodeField ? 'grid-cols-2' : 'grid-cols-1'
            )}
          >
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 min-h-4 flex items-center">
                Contributor / Signer Name
              </span>
              <input
                id="input-signer-tag"
                type="text"
                value={signerInput}
                onChange={handleSignerChange}
                placeholder="e.g. Amina (Lagos)"
                maxLength={48}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </label>

            {showPasscodeField && (
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 min-h-4 flex items-center gap-1">
                  <KeyRound className="w-3 h-3 text-amber-400" />
                  <span>Team Access Code</span>
                </span>
                <input
                  id="input-team-passcode"
                  type="password"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Team code"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </label>
            )}
          </div>

          {cloudConfigured ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/75 border border-white/[0.06] text-xs">
                <span className="text-slate-300">
                  Team DB:{' '}
                  <strong className="text-white">{cloudSummary?.totalSamples ?? 0}</strong> clips •{' '}
                  <strong className="text-cyan-300">{cloudSummary?.signersCount ?? 0}</strong>{' '}
                  signer(s)
                </span>
                <span
                  className={clsx(
                    'text-[11px] font-semibold',
                    unsyncedSamples.length > 0 ? 'text-amber-300' : 'text-emerald-300'
                  )}
                >
                  {unsyncedSamples.length > 0
                    ? `${unsyncedSamples.length} unsynced`
                    : 'All synced'}
                </span>
              </div>

              <button
                id="btn-submit-cloud"
                onClick={handleSubmitToCloud}
                disabled={unsyncedSamples.length === 0 || cloudBusy !== 'idle'}
                className={clsx(
                  'w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors',
                  unsyncedSamples.length > 0 && cloudBusy === 'idle'
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 cursor-pointer shadow-md shadow-cyan-500/15'
                    : 'bg-slate-900/70 border border-white/[0.06] text-slate-500 cursor-not-allowed'
                )}
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {cloudBusy === 'syncing'
                    ? 'Uploading Clips to Team DB...'
                    : unsyncedSamples.length > 0
                    ? `Submit ${unsyncedSamples.length} Clip(s) to Team DB`
                    : 'No New Local Clips to Upload'}
                </span>
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Offline/JSON mode active. Record clips cleanly below and tap Share/Export JSON to
              send your batch to the team lead.
            </p>
          )}
        </section>

        {/* Camera Preview + Live Capture Overlay */}
        <div className="relative">
          <CameraViewport
            state={capturePhase === 'recording' ? 'tracking' : cameraActive ? 'ready' : 'idle'}
            forceEnglish
            onCameraToggle={handleCameraToggle}
            onTrackerReadyChange={setTrackerReady}
            onTrackingFrame={handleTrackingFrame}
          />

          {capturePhase === 'countdown' && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-3xl bg-black/55 backdrop-blur-[2px] pointer-events-none">
              <span className="text-[11px] font-bold uppercase tracking-widest text-cyan-300 mb-1">
                Get Ready
              </span>
              <span className="text-6xl font-black text-white tabular-nums">{countdownLeft}</span>
            </div>
          )}

          {capturePhase === 'recording' && (
            <div className="absolute top-12 inset-x-3 z-30 flex items-center justify-between pointer-events-none">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600/90 text-white text-xs font-bold shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>
                  {captureExtending
                    ? `HOLD • ${capturedFramesCount}/${NSL_MIN_RAW_FRAMES}f`
                    : `REC • ${capturedFramesCount}f`}
                </span>
              </div>
              <span
                className={clsx(
                  'px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md border',
                  handsVisibleLive
                    ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
                    : 'bg-amber-500/25 border-amber-400/50 text-amber-200'
                )}
              >
                {handsVisibleLive ? 'Hands Locked' : 'Show Hands'}
              </span>
            </div>
          )}
        </div>

        {/* Clip Duration Selector & Capture Action Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-slate-400">
              Clip window (min {NSL_MIN_RAW_FRAMES}+ tracked frames)
            </span>
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#0c1322] border border-white/[0.08]">
              {CAPTURE_DURATION_OPTIONS.map((ms) => (
                <button
                  key={ms}
                  type="button"
                  disabled={capturePhase !== 'idle'}
                  onClick={() => setCaptureDurationMs(ms)}
                  className={clsx(
                    'px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-60',
                    captureDurationMs === ms
                      ? 'bg-cyan-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  )}
                >
                  {ms / 1000}s
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-record-nsl-clip"
              onClick={handleStartCapture}
              className={clsx(
                'flex-1 py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer',
                capturePhase === 'recording'
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : capturePhase === 'countdown'
                  ? 'bg-amber-500 text-slate-950'
                  : cameraActive
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20'
                  : 'bg-slate-800 text-slate-400'
              )}
            >
              {capturePhase === 'idle' ? (
                <>
                  <Circle className="w-4 h-4 fill-current" />
                  <span>
                    Record {captureDurationMs / 1000}s Clip ({selectedLabel?.name ?? 'NSL Sign'})
                  </span>
                </>
              ) : capturePhase === 'countdown' ? (
                <>
                  <X className="w-4 h-4" />
                  <span>Cancel ({countdownLeft}s)</span>
                </>
              ) : captureExtending ? (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>
                    Waiting for frames… ({capturedFramesCount}/{NSL_MIN_RAW_FRAMES})
                  </span>
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 fill-current" />
                  <span>Recording… ({capturedFramesCount} frames)</span>
                </>
              )}
            </button>

            {capturePhase === 'recording' && (
              <button
                onClick={finishRecording}
                className="px-3.5 py-3 rounded-2xl bg-white/10 border border-white/15 text-xs font-bold text-white cursor-pointer"
              >
                Finish
              </button>
            )}
          </div>
        </div>

        {/* Live Hand Status Hint */}
        {cameraActive && capturePhase === 'idle' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#0c1322] border border-white/[0.08] text-xs">
            <span className="flex items-center gap-2 text-slate-300">
              <Hand
                className={clsx(
                  'w-4 h-4',
                  !trackerReady
                    ? 'text-amber-400 animate-pulse'
                    : handsVisibleLive
                    ? 'text-emerald-400'
                    : 'text-slate-500'
                )}
              />
              <span>
                {!trackerReady
                  ? 'Warming up AI hand & body tracker...'
                  : handsVisibleLive
                  ? 'Signing hands detected cleanly'
                  : 'Position torso and signing hands inside frame'}
              </span>
            </span>
            <span className="text-[11px] font-mono text-cyan-400">145-dim</span>
          </div>
        )}

        {/* Feedback Banner */}
        {statusBanner && (
          <div
            className={clsx(
              'px-3.5 py-2.5 rounded-xl border text-xs flex items-start gap-2',
              statusBanner.tone === 'success' &&
                'bg-emerald-950/60 border-emerald-500/35 text-emerald-200',
              statusBanner.tone === 'error' &&
                'bg-rose-950/60 border-rose-500/35 text-rose-200',
              statusBanner.tone === 'info' && 'bg-cyan-950/60 border-cyan-500/35 text-cyan-200'
            )}
          >
            {statusBanner.tone === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            )}
            <span>{statusBanner.message}</span>
          </div>
        )}

        {/* Target Sign Label Picker */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Target Sign Label
            </span>
            <button
              onClick={() => setShowAddLabel((prev) => !prev)}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Sign</span>
            </button>
          </div>

          {showAddLabel && (
            <form onSubmit={handleAddCustomLabel} className="flex items-center gap-2">
              <input
                ref={customInputRef}
                type="text"
                placeholder="e.g. Water, Market, Good Morning"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold cursor-pointer"
              >
                Save
              </button>
            </form>
          )}

          <div className="flex flex-wrap gap-1.5">
            {labels.map((label) => {
              const localCount = countsByLabel[label.id] ?? 0;
              const teamCount = cloudCountByLabel[label.id] ?? 0;
              const isSelected = selectedLabel?.id === label.id;
              return (
                <button
                  key={label.id}
                  onClick={() => setSelectedLabelId(label.id)}
                  className={clsx(
                    'px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer',
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-950/70 border-white/[0.08] text-slate-300 hover:border-white/20'
                  )}
                >
                  <span>{label.name}</span>
                  <span
                    className={clsx(
                      'px-1.5 py-0.5 rounded-md text-[10px] font-mono',
                      localCount + teamCount >= 5
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : localCount + teamCount > 0
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-white/[0.06] text-slate-500'
                    )}
                  >
                    {cloudConfigured ? `${localCount}/${teamCount}` : localCount}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            {cloudConfigured
              ? 'Badge shows local / team DB clips. Aim for 5+ clips per sign across multiple contributors.'
              : 'Aim for 5+ varied clips per sign before training or exporting.'}
          </p>
        </section>

        {/* Share / Export / Import / Manage Clips */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleShareOrExportJson}
              disabled={samples.length === 0}
              className={clsx(
                'py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer',
                samples.length > 0
                  ? 'bg-cyan-500/15 border-cyan-500/35 text-cyan-200 hover:bg-cyan-500/25'
                  : 'bg-slate-900/60 border-white/[0.06] text-slate-600 cursor-not-allowed'
              )}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share / Export JSON</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import JSON</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          {samples.length > 0 && (
            <div className="space-y-2 pt-1 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Local Clips ({samples.length})
                </span>
                <button
                  onClick={handleClearDataset}
                  className={clsx(
                    'text-[11px] font-semibold cursor-pointer',
                    confirmClear ? 'text-rose-400' : 'text-slate-500 hover:text-rose-400'
                  )}
                >
                  {confirmClear ? 'Tap again to clear all' : 'Clear All'}
                </button>
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                {samples.slice(0, 16).map((sample) => {
                  const isSynced = syncedIds.has(sample.id);
                  return (
                    <div
                      key={sample.id}
                      className="px-2.5 py-2 rounded-xl bg-slate-950/70 border border-white/[0.06] flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-white truncate">{sample.labelName}</p>
                          {isSynced && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-[9px] font-bold uppercase text-emerald-300">
                              Synced
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {normalizeSignerTag(sample.signerTag)} • {sample.rawFrameCount}f •{' '}
                          {Math.round(sample.handCoverageRatio * 100)}% hands
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteSample(sample.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                        aria-label={`Delete clip for ${sample.labelName}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Model Training & Weight Distribution */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                NSL Model Training
              </span>
            </div>
            {trainedModel ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-300">
                Ready • {trainedModel.classes.length} signs
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">Not trained</span>
            )}
          </div>

          {trainedModel ? (
            <div className="px-3 py-2 rounded-xl bg-slate-950/75 border border-white/[0.06] text-xs space-y-0.5">
              <p className="text-slate-200 font-medium">
                Val {Math.round(trainedModel.metrics.valAccuracy * 100)}% • Train{' '}
                {Math.round(trainedModel.metrics.trainAccuracy * 100)}% •{' '}
                {trainedModel.metrics.sampleCount} clips
                {trainedModel.metrics.splitStrategy === 'signer-grouped'
                  ? ' • Signer-Grouped Val'
                  : ' • Clip-Split Val'}
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                Classes: {trainedModel.classes.map((c) => c.name).join(', ')}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Train directly on local clips ({trainableClassesCount}/2+ signs with 2+ clips each) or
              pull the full team dataset from cloud.
            </p>
          )}

          <div className="space-y-2">
            {cloudConfigured && (
              <button
                id="btn-pull-team-train"
                onClick={handlePullTeamAndTrain}
                disabled={cloudBusy !== 'idle' || (cloudSummary?.totalSamples ?? 0) < 4}
                className={clsx(
                  'w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors',
                  cloudBusy === 'idle' && (cloudSummary?.totalSamples ?? 0) >= 4
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-md shadow-emerald-500/15'
                    : 'bg-slate-900/70 border border-white/[0.06] text-slate-500 cursor-not-allowed'
                )}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>
                  {cloudBusy === 'pulling'
                    ? 'Pulling Team Dataset & Training...'
                    : 'Pull Team Dataset & Train Model'}
                </span>
              </button>
            )}

            <button
              id="btn-train-nsl-model"
              onClick={handleTrainLocalModel}
              disabled={trainableClassesCount < 2}
              className={clsx(
                'w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors',
                trainableClassesCount >= 2
                  ? cloudConfigured
                    ? 'bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white cursor-pointer'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-md shadow-emerald-500/15'
                  : 'bg-slate-900/70 border border-white/[0.06] text-slate-500 cursor-not-allowed'
              )}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{trainedModel ? 'Retrain on Local Clips' : 'Train on Local Clips'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportModelJson}
              disabled={!trainedModel}
              className={clsx(
                'flex-1 py-2 px-3 rounded-xl border text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer',
                trainedModel
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200 hover:bg-cyan-500/20'
                  : 'bg-slate-900/60 border-white/[0.06] text-slate-600 cursor-not-allowed'
              )}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Model</span>
            </button>

            <button
              onClick={() => modelFileInputRef.current?.click()}
              className="flex-1 py-2 px-3 rounded-xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-[11px] font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Load Model</span>
            </button>

            {trainedModel && (
              <button
                onClick={handleClearModel}
                className="p-2 rounded-xl bg-white/[0.04] border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 cursor-pointer"
                aria-label="Clear trained NSL model"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <input
              ref={modelFileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportModelFile}
              className="hidden"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
