import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { text, targetLang } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text parameter is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    const langMap: Record<string, string> = {
      ha: 'Hausa',
      yo: 'Yoruba',
      ig: 'Igbo',
      pcm: 'Nigerian Pidgin',
      en: 'English (Nigeria)',
    };

    const targetLanguageName = langMap[targetLang] || 'English';

    const prompt = `You are a high-speed, culturally authentic language translator for SignBridge AI (a Nigerian Sign Language platform).
Translate the following sentence into ${targetLanguageName}.
Keep the translation concise, accurate, and natural for everyday spoken conversation in Nigeria.
Respond ONLY with the translated text, with no quotation marks, no preamble, and no explanation.

Text to translate:
"${text.trim()}"`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: 'Gemini translation failed', details: errText }, { status: res.status });
    }

    const data = await res.json();
    const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;

    return NextResponse.json({
      translatedText,
      targetLang,
    });
  } catch (error: any) {
    console.error('Translation route exception:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
