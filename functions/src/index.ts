import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import OpenAI from 'openai';

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

type GenerateIdeasPayload = {
  system?: string;
  constraints?: {
    maxMissing?: number;
    time?: number | null;
    cuisines?: string[];
    starIngredient?: string | null;
  };
  userPrompt?: string;
  pantry?: string[];
};

type LlmIdea = {
  title: string;
  ingredients: string[];
  steps: string[];
};

export const generateIdeas = onRequest(
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [OPENAI_API_KEY],
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'content-type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }

    try {
      const body = (req.body ?? {}) as GenerateIdeasPayload;
      const pantryRaw = Array.isArray(body.pantry) ? body.pantry : null;

      if (!pantryRaw) {
        res.status(400).json({ error: 'payload.pantry must be an array of strings' });
        return;
      }

      const pantry = uniqueStrings(
        pantryRaw
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      );

      if (!pantry.length) {
        res.status(400).json({ error: 'Pantry cannot be empty' });
        return;
      }

      const maxMissing = sanitizeMaxMissing(body.constraints?.maxMissing);
      const time = sanitizeTime(body.constraints?.time);
      const cuisines = Array.isArray(body.constraints?.cuisines)
        ? uniqueStrings(
            body.constraints!.cuisines!
              .map((x) => String(x || '').trim())
              .filter(Boolean)
          ).slice(0, 6)
        : [];
      const starIngredient = String(body.constraints?.starIngredient || '').trim() || null;
      const userPrompt = String(body.userPrompt || '').trim();
      const system =
        String(body.system || '').trim() ||
        'You are a culinary assistant. Respect halal; avoid alcohol. Keep steps concise, practical, and reproducible.';

      const outputRules = buildOutputRules({
        pantry,
        maxMissing,
        time,
        cuisines,
        starIngredient,
      });

      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value(),
      });

      const completion = await client.chat.completions.create({
        model: 'gpt-5.4',
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [userPrompt, outputRules].filter(Boolean).join('\n\n'),
          },
        ],
      });

      const text = completion.choices?.[0]?.message?.content || '[]';
      const parsed = parseIdeasFromModel(text);
      const ideas = parsed
        .map(normalizeIdea)
        .filter((idea) => idea.title && idea.ingredients.length && idea.steps.length)
        .slice(0, 6);

      res.json({ ideas });
    } catch (err: any) {
      console.error('[generateIdeas]', err);
      res.status(500).json({ error: err?.message ?? 'LLM error' });
    }
  }
);

function buildOutputRules(args: {
  pantry: string[];
  maxMissing: 0 | 1 | 2;
  time: number | null;
  cuisines: string[];
  starIngredient: string | null;
}): string {
  return `
Return ONLY a JSON array with exactly 6 items.

Each item must be:
{
  "title": string,
  "ingredients": string[],
  "steps": string[]
}

Rules:
- Use pantry items whenever possible.
- Pantry items available: ${args.pantry.join(', ')}.
- Each idea may include at most ${args.maxMissing} ingredients not found in the pantry list.
- ${args.time ? `Target total cooking time: ${args.time} minutes or less.` : 'Cooking time: any.'}
- ${args.cuisines.length ? `Favor these cuisines/styles: ${args.cuisines.join(', ')}.` : 'Cuisine/style: any.'}
- ${args.starIngredient ? `Center the ideas around this ingredient when suitable: ${args.starIngredient}.` : 'No star ingredient is required.'}
- Keep titles natural and appetizing.
- Ingredients should be simple strings only, no quantities.
- Steps must be concise, practical, and 4 to 7 items long.
- Do not include markdown.
- Do not include commentary.
- Do not include code fences.
- Output raw JSON only.
`.trim();
}

function parseIdeasFromModel(text: string): any[] {
  const cleaned = text.trim().replace(/^```json\s*|\s*```$/g, '');

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function normalizeIdea(raw: any): LlmIdea {
  return {
    title: String(raw?.title || '').trim(),
    ingredients: Array.isArray(raw?.ingredients)
      ? uniqueStrings(
          raw.ingredients
            .map((x: any) => String(x || '').trim())
            .filter(Boolean)
        )
      : [],
    steps: Array.isArray(raw?.steps)
      ? raw.steps
          .map((x: any) => String(x || '').trim())
          .filter(Boolean)
      : [],
  };
}

function sanitizeMaxMissing(value: unknown): 0 | 1 | 2 {
  const num = Number(value);
  return num === 0 || num === 1 || num === 2 ? num : 1;
}

function sanitizeTime(value: unknown): number | null {
  const num = Number(value);
  const allowed = new Set([10, 15, 20, 30, 45, 60]);
  return allowed.has(num) ? num : null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}