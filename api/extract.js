import { isAuthed } from '../lib/auth.js';
import { readBody } from '../lib/http.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthed(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const text = body?.text?.trim() || '';
  const image = body?.image;
  const audio = body?.audio;

  if (!text && !image && !audio) {
    return res.status(400).json({ error: 'Provide text, image, or audio' });
  }

  // Cap payload size and restrict mime types — these are forwarded to a billable
  // third-party (Gemini), so unbounded/arbitrary input is an abuse and cost vector.
  const MAX_B64 = 8 * 1024 * 1024; // ~6 MB once decoded
  const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
  const ALLOWED_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/aac'];
  if (image) {
    if (typeof image.data !== 'string' || !ALLOWED_IMAGE.includes(image.mimeType)) {
      return res.status(400).json({ error: 'Unsupported or invalid image' });
    }
    if (image.data.length > MAX_B64) return res.status(413).json({ error: 'Image too large' });
  }
  if (audio) {
    if (typeof audio.data !== 'string' || !ALLOWED_AUDIO.includes(audio.mimeType)) {
      return res.status(400).json({ error: 'Unsupported or invalid audio' });
    }
    if (audio.data.length > MAX_B64) return res.status(413).json({ error: 'Audio too large' });
  }

  const today = new Date().toISOString().slice(0, 10);

  const sources = [];
  if (text) sources.push('the text description below');
  if (audio) sources.push('the attached audio (spoken description, English or Arabic)');
  if (image) sources.push('the attached image (equipment, a nameplate, a business card, or written notes — read any visible text)');

  let prompt = `Extract sales site fields from ${sources.join(' AND ')}.

Fields:
- name: site/company name
- contact: person's name
- phone: phone number
- equipment: type of equipment (boiler, chiller, AC, etc.)
- specs: technical specs like tons, kW, capacity
- location: city or area
- status: one of ["Potential Prospect", "Qualified Prospect", "Interested Prospect", "Hot Prospect"] — infer from context. Potential = just identified, Qualified = fits criteria, Interested = engaged/responsive, Hot = ready to close
- nextAction: what needs to be done next
- dueDate: YYYY-MM-DD if mentioned (e.g. "next week" = 7 days from ${today}, "tomorrow" = tomorrow), otherwise ""
- notes: any other relevant info

If a field is not mentioned, return "".`;

  if (text) prompt += `\n\nText description: "${text}"`;

  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  if (audio) parts.push({ inline_data: { mime_type: audio.mimeType, data: audio.data } });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    );

    const data = await r.json();
    if (!r.ok) {
      console.error('Gemini API error:', data?.error?.message || r.status);
      return res.status(502).json({ error: 'Extraction service error' });
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('extract api error:', err);
    return res.status(500).json({ error: 'Extraction failed' });
  }
}
