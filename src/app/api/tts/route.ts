import { NextRequest, NextResponse } from 'next/server';

function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  // "RIFF" chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // "fmt " sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export async function POST(req: NextRequest) {
  try {
    const { text, lang } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const prompt = text.trim();

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini TTS error:', errText);
      return NextResponse.json({ error: 'Gemini TTS synthesis failed', details: errText }, { status: res.status });
    }

    const data = await res.json();
    const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!inlineData?.data) {
      return NextResponse.json({ error: 'No audio returned from Gemini' }, { status: 502 });
    }

    const pcmBuffer = Buffer.from(inlineData.data, 'base64');
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);

    return new Response(new Uint8Array(wavBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': wavBuffer.length.toString(),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error: any) {
    console.error('TTS route exception:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
