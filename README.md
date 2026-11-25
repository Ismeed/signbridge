# SignBridge AI 🌉🧏‍♂️

> **Assistive Nigerian Sign Language (NSL) Translation & Speech Platform**

SignBridge AI is an accessible assistive communication platform designed to bridge deaf and hearing interactions across Nigeria. Built with client-side MediaPipe computer vision, an on-device spatio-temporal neural sequence classifier, and multilingual Nigerian speech synthesis, SignBridge AI interprets sign gestures directly in the browser and speaks naturally in major Nigerian languages.

---

## ✨ Key Features

- **On-Device Neural Sign Recognition**: Real-time upper-body pose and 42-joint 3D hand tracking powered by `@mediapipe/tasks-vision`, mapped into scale-, translation-, and chirality-invariant `[30 × 145]` spatio-temporal feature clips (`nsl-v1`).
- **Pre-Bundled 16-Sign NSL Baseline Model (`/models/nsl-model.json`)**: Ships ready out-of-the-box across essential greetings, politeness, clinic/emergency triage, directions, and market communication—with an explicit `__idle__` rejection class and 4-gate out-of-distribution filtering.
- **Zero Cloud Video Upload / 100% Private**: Camera frames are processed strictly in local device RAM—no video or imagery ever leaves the user's device.
- **Multilingual Nigerian Translation & Neural Speech Output**:
  - 🇳🇬 **Hausa** (`ha-NG`) — *Harshen Hausa*
  - 🇳🇬 **English (Nigeria)** (`en-NG`)
  - 🇳🇬 **Yoruba** (`yo-NG`) — *Èdè Yorùbá*
  - 🇳🇬 **Igbo** (`ig-NG`) — *Asụsụ Igbo*
  - 🇳🇬 **Nigerian Pidgin** (`pcm`) — *Naija Pidgin*
- **NSL Data Studio (`/collect`) & Shared Supabase Dataset**: Dedicated contributor portal for recording native Nigerian Sign Language clips, syncing batches to a passcode-protected Supabase Postgres dataset, and retraining models in-browser or via CLI.
- **Accessibility & Motion Controls**: Built-in support for reduced-motion preferences, dynamic font scaling, haptic feedback, and high-contrast palettes.

---

## 🚀 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Library**: [React 19](https://react.dev/)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Vision ML**: [@mediapipe/tasks-vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (`PoseLandmarker` + `HandLandmarker`)
- **Translation & Neural TTS**: Google Gemini API with automatic model fallback + offline Web Speech API (`SpeechSynthesis`) fallback
- **Team Dataset Store**: Supabase Postgres (`public.nsl_samples` with strict RLS)

---

## 🛠️ Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm

### Installation & Local Development

```bash
git clone https://github.com/Ismeed/signbridge.git
cd signbridge
npm install
npm run dev
```

Open `http://localhost:3000` in your browser (`http://localhost:3000/collect` for the NSL Data Studio).

> **Note**: Camera features require `localhost` or an HTTPS connection.

### Environment Variables (Optional)

Create `.env.local` for cloud translation/TTS and shared team NSL collection:

```env
# Gemini multilingual translation & neural TTS (falls back to offline presets + Web Speech API)
GEMINI_API_KEY=your_gemini_api_key

# Shared NSL Data Studio (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_or_secret_key
NSL_COLLECT_PASSCODE=team_contributor_passcode
NSL_ADMIN_PASSCODE=team_lead_export_passcode

# Optional deployment mode: 'consumer' | 'collector' (omit to enable both '/' and '/collect')
NEXT_PUBLIC_APP_MODE=
```

### NSL Model Seeding & Training

```bash
# Build curated NSL-cognate [30x145] seed dataset from MediaPipe .pose sequences
npm run seed:nsl

# Train compact on-device model weights -> public/models/nsl-model.json
npm run train:nsl -- data/nsl-seed-dataset.json

# Hybrid training: merge seed dataset + live native Nigerian clips from Supabase (upweighted 2.5x)
npm run train:nsl -- data/nsl-seed-dataset.json --supabase
```

### Production Build

```bash
npm run lint
npm run build
npm run start
```

---

## 🔒 Privacy & Data Architecture

SignBridge AI operates on strict edge-computing principles:
1. **Camera Consent**: Camera hardware is accessed only after explicit user interaction (`Start Camera`).
2. **Volatile Memory**: Live camera frames are analyzed on-device to calculate normalized skeletal landmarks and immediately discarded.
3. **Protected Team Collection**: When contributors explicitly submit clips in `/collect`, only anonymized `[30 × 145]` numeric landmark tensors (never raw images or video) are stored in `public.nsl_samples` behind Row-Level Security and team passcode verification.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
