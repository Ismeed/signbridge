# SignBridge AI 🌉🧏‍♂️

> **Assistive Nigerian Sign Language (NSL) Translation & Speech Platform**

SignBridge AI is an accessible assistive communication platform designed to bridge deaf and hearing interactions. Built with lightweight, client-side computer vision and native multilingual speech synthesis, SignBridge AI interprets sign gestures directly in the browser and articulates spoken phrases in major Nigerian languages.

---

## ✨ Key Features

- **On-Device Computer Vision**: Real-time person tracking and sign gesture zone monitoring powered by `@mediapipe/tasks-vision`.
- **Zero Cloud Upload / 100% Private**: Camera frames are processed strictly in local device RAM—no video or imagery ever leaves the user's device.
- **Multilingual Nigerian Speech Output**:
  - 🇳🇬 **Hausa** (`ha-NG`) — *Harshen Hausa*
  - 🇳🇬 **English (Nigeria)** (`en-NG`)
  - 🇳🇬 **Yoruba** (`yo-NG`) — *Èdè Yorùbá*
  - 🇳🇬 **Igbo** (`ig-NG`) — *Asụsụ Igbo*
  - 🇳🇬 **Nigerian Pidgin** (`pcm`) — *Naija Pidgin*
- **Curated Sign Phrase Library**: Instant translations with phonetic pronunciation guides and physical gesture descriptions across essential communication, navigation, social connection, and emergency assistance.
- **Dynamic Waveform Visualizer**: Live audio equalizer reacting in real time to speech synthesis events (`onstart`, `onboundary`, `onend`).
- **Showcase Presentation Mode**: High-contrast, presentation-optimized interface designed for mobile screen demonstrations and audience pitches.
- **Accessibility & Motion Controls**: Built-in support for reduced-motion preferences, dynamic font scaling, and high-contrast color palettes.

---

## 🚀 Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Library**: [React 19](https://react.dev/)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Vision ML**: [@mediapipe/tasks-vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Speech Engine**: Web Speech API (`SpeechSynthesis`)

---

## 🛠️ Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/Ismeed/signbridge.git
cd signbridge

# Install dependencies
npm install
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note**: Camera features require `localhost` or an HTTPS connection.

### Production Build

```bash
npm run build
npm run start
```

---

## 🔒 Privacy & Data Architecture

SignBridge AI operates on strict edge-computing principles:
1. **Camera Consent**: Camera hardware is accessed only after explicit user interaction (`Start Camera`).
2. **Volatile Memory**: Stream frames are analyzed on-device to calculate landmark coordinates; frames are immediately discarded.
3. **No Tracking / Telemetry**: No personal identification or camera telemetry is gathered or transmitted.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
