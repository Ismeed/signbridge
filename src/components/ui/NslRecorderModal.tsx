'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  X,
  Circle,
  Square,
  Download,
  Upload,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Hand,
  Cpu,
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
  mergeImportedDataset,
  parseImportedDatasetJson,
  saveNslSample,
  serializeDatasetJson,
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

interface NslRecorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSampleCountChange?: (count: number) => void;
}

type CapturePhase = 'idle' | 'countdown' | 'recording';

interface StatusBanner {
  tone: 'success' | 'error' | 'info';
  message: string;
}

const COUNTDOWN_SECONDS = 2;
const RECORD_DURATION_MS = 2000;

export function NslRecorderModal({
  isOpen,
  onClose,
  onSampleCountChange,
}: NslRecorderModalProps) {
  const { preferences } = useApp();

  const [labels, setLabels] = useState<NslLabelDefinition[]>(() => getAllNslLabels());
  const [samples, setSamples] = useState<NslRecordedSample[]>(() => loadNslSamples());
  const [selectedLabelId, setSelectedLabelId] = useState<string>('greeting');
  const [showAddLabel, setShowAddLabel] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle');
  const [countdownLeft, setCountdownLeft] = useState<number>(COUNTDOWN_SECONDS);
  const [capturedFramesCount, setCapturedFramesCount] = useState<number>(0);
  const [handsVisibleLive, setHandsVisibleLive] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [trainedModel, setTrainedModel] = useState<NslTrainedModel | null>(() => loadTrainedModel());
  const [statusBanner, setStatusBanner] = useState<StatusBanner | null>(null);

  const customInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelFileInputRef = useRef<HTMLInputElement>(null);

  // High-frequency capture buffers stored in refs to avoid 60Hz React re-renders.
  const isRecordingRef = useRef<boolean>(false);
  const rawFeaturesRef = useRef<NslFrameFeatures[]>([]);
  const rawVectorsRef = useRef<number[][]>([]);
  const prevFrameRef = useRef<TrackingFrame | null>(null);
  const recordStartPerfRef = useRef<number>(0);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const selectedLabelRef = useRef<{ id: string; name: string }>({
    id: 'greeting',
    name: 'Greeting & Peace',
  });

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedLabel = useMemo(
    () => labels.find((item) => item.id === selectedLabelId) ?? labels[0],
    [labels, selectedLabelId]
  );

  useEffect(() => {
    if (selectedLabel) {
      selectedLabelRef.current = { id: selectedLabel.id, name: selectedLabel.name };
    }
  }, [selectedLabel]);

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
  }, []);

  const resetCaptureState = useCallback(() => {
    clearActiveTimers();
    isRecordingRef.current = false;
    rawFeaturesRef.current = [];
    rawVectorsRef.current = [];
    prevFrameRef.current = null;
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
      setStatusBanner({
        tone: 'error',
        message:
          quality.rawFrameCount < NSL_MIN_RAW_FRAMES
            ? `Only ${quality.rawFrameCount} frames captured (need ${NSL_MIN_RAW_FRAMES}+). Keep camera active and retry.`
            : `Low hand visibility (${handPct}% across ${quality.rawFrameCount} frames). Keep signing hands in frame.`,
      });
      return;
    }

    const resampled = resampleNslSequence(capturedVectors, NSL_SEQUENCE_LENGTH);
    const activeLabel = selectedLabelRef.current;
    const result = saveNslSample({
      labelId: activeLabel.id,
      labelName: activeLabel.name,
      sequence: resampled,
      quality,
      cameraFacing: facingModeRef.current,
    });

    if (!result.ok) {
      setStatusBanner({ tone: 'error', message: result.error });
      return;
    }

    setSamples(result.samples);
    onSampleCountChange?.(result.samples.length);
    triggerHaptic('heavy', preferences.hapticsEnabled);

    const coveragePct = Math.round(quality.handCoverageRatio * 100);
    setStatusBanner({
      tone: 'success',
      message: `Saved "${activeLabel.name}" (${quality.rawFrameCount} frames -> ${NSL_SEQUENCE_LENGTH}x${resampled[0].length}, ${coveragePct}% hands).`,
    });
  }, [clearActiveTimers, onSampleCountChange, preferences.hapticsEnabled]);

  const beginRecordingWindow = useCallback(() => {
    rawFeaturesRef.current = [];
    rawVectorsRef.current = [];
    prevFrameRef.current = null;
    recordStartPerfRef.current = performance.now();
    isRecordingRef.current = true;
    setCapturePhase('recording');
    setCapturedFramesCount(0);
    triggerHaptic('medium', preferences.hapticsEnabled);

    progressTimerRef.current = setInterval(() => {
      setCapturedFramesCount(rawVectorsRef.current.length);
    }, 100);

    finishTimerRef.current = setTimeout(() => {
      finishRecording();
    }, RECORD_DURATION_MS);
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

  const handleAddCustomLabel = (e: React.FormEvent) => {
    e.preventDefault();
    const rawValue = customInputRef.current?.value ?? ' ';
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
    onSampleCountChange?.(updated.length);
  };

  const handleClearDataset = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearNslDataset();
    setSamples([]);
    setConfirmClear(false);
    onSampleCountChange?.(0);
    setStatusBanner({ tone: 'info', message: 'All recorded NSL clips cleared from this device.' });
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

  const handleExportJson = () => {
    if (samples.length === 0) return;
    const dateStamp = new Date().toISOString().slice(0, 10);
    triggerJsonDownload(
      `signbridge-nsl-dataset-${dateStamp}.json`,
      serializeDatasetJson(samples, labels)
    );
    setStatusBanner({
      tone: 'success',
      message: `Exported ${samples.length} labeled NSL clip(s) as JSON.`,
    });
  };

  const handleTrainModel = () => {
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
      message: `Trained NSL model on ${result.model.classes.length} signs (Val ${valPct}%, Train ${trainPct}%).`,
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
    setStatusBanner({ tone: 'info', message: 'Cleared on-device NSL model weights.' });
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
      onSampleCountChange?.(merged.totalCount);
      setStatusBanner({
        tone: 'success',
        message: `Imported ${merged.addedCount} new clip(s) (${merged.totalCount} total).`,
      });
    } catch {
      setStatusBanner({ tone: 'error', message: 'Failed to read selected JSON file.' });
    }
  };

  const countsByLabel = useMemo(() => countSamplesByLabel(samples), [samples]);
  const coveredLabelsCount = useMemo(
    () => labels.filter((label) => (countsByLabel[label.id] ?? 0) > 0).length,
    [labels, countsByLabel]
  );
  const trainableClassesCount = useMemo(
    () => Object.values(countsByLabel).filter((count) => count >= 2).length,
    [countsByLabel]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#060913]/95 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="NSL Dataset Recorder"
    >
      <div className="max-w-md mx-auto w-full px-4 py-4 pb-10 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              NSL Sign Recorder
            </h2>
            <p className="text-[11px] text-slate-400">
              {samples.length} clips saved • {coveredLabelsCount}/{labels.length} signs ready
            </p>
          </div>
          <button
            onClick={() => {
              resetCaptureState();
              setCameraActive(false);
              setHandsVisibleLive(false);
              onClose();
            }}
            className="p-2 rounded-xl bg-white/[0.06] border border-white/10 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Close NSL Sign Recorder"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera Preview + Live Capture Overlay */}
        <div className="relative">
          <CameraViewport
            state={capturePhase === 'recording' ? 'tracking' : cameraActive ? 'ready' : 'idle'}
            onCameraToggle={handleCameraToggle}
            onTrackingFrame={handleTrackingFrame}
          />

          {capturePhase === 'countdown' && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-3xl bg-black/55 backdrop-blur-[2px] pointer-events-none">
              <span className="text-[11px] font-bold uppercase tracking-widest text-cyan-300 mb-1">
                Get Ready
              </span>
              <span className="text-6xl font-black text-white tabular-nums">
                {countdownLeft}
              </span>
            </div>
          )}

          {capturePhase === 'recording' && (
            <div className="absolute top-12 inset-x-3 z-30 flex items-center justify-between pointer-events-none">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-600/90 text-white text-xs font-bold shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>REC • {capturedFramesCount}f</span>
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

        {/* Capture Action Bar */}
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
                <span>Record 2s Clip</span>
              </>
            ) : capturePhase === 'countdown' ? (
              <>
                <X className="w-4 h-4" />
                <span>Cancel ({countdownLeft}s)</span>
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

        {/* Live Hand Status Hint */}
        {cameraActive && capturePhase === 'idle' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#0c1322] border border-white/[0.08] text-xs">
            <span className="flex items-center gap-2 text-slate-300">
              <Hand
                className={clsx(
                  'w-4 h-4',
                  handsVisibleLive ? 'text-emerald-400' : 'text-slate-500'
                )}
              />
              <span>
                {handsVisibleLive
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
              statusBanner.tone === 'info' &&
                'bg-cyan-950/60 border-cyan-500/35 text-cyan-200'
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
              const count = countsByLabel[label.id] ?? 0;
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
                      count >= 5
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : count > 0
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'bg-white/[0.06] text-slate-500'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            Aim for 5+ varied clips per sign before training the NSL classifier.
          </p>
        </section>

        {/* Export / Import / Manage */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportJson}
              disabled={samples.length === 0}
              className={clsx(
                'py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer',
                samples.length > 0
                  ? 'bg-cyan-500/15 border-cyan-500/35 text-cyan-200 hover:bg-cyan-500/25'
                  : 'bg-slate-900/60 border-white/[0.06] text-slate-600 cursor-not-allowed'
              )}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
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
                  Recent Clips ({samples.length})
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

              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {samples.slice(0, 12).map((sample) => (
                  <div
                    key={sample.id}
                    className="px-2.5 py-2 rounded-xl bg-slate-950/70 border border-white/[0.06] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{sample.labelName}</p>
                      <p className="text-[10px] text-slate-400">
                        {sample.rawFrameCount}f • {Math.round(sample.durationMs / 100) / 10}s •{' '}
                        {Math.round(sample.handCoverageRatio * 100)}% hands ({sample.handedness})
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
                ))}
              </div>
            </div>
          )}
        </section>

        {/* On-Device Model Training */}
        <section className="rounded-2xl bg-[#0c1322] border border-white/[0.08] p-3.5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                On-Device NSL Model
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
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                Classes: {trainedModel.classes.map((c) => c.name).join(', ')}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Train directly on your recorded clips ({trainableClassesCount}/2+ ready signs with 2+ clips each).
            </p>
          )}

          <button
            id="btn-train-nsl-model"
            onClick={handleTrainModel}
            disabled={trainableClassesCount < 2}
            className={clsx(
              'w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer',
              trainableClassesCount >= 2
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/15'
                : 'bg-slate-900/70 border border-white/[0.06] text-slate-500 cursor-not-allowed'
            )}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>{trainedModel ? 'Retrain NSL Model' : 'Train NSL Model'}</span>
          </button>

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
