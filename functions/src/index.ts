import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import OpenAI from 'openai';

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

type GenerateIdeasPayload = {
  system?: string;
  constraints?: {
    ideaCount?: number;
    maxMissing?: number;
    time?: number | null;
    cuisines?: string[];
    starIngredient?: string | null;
    preferRealRecipes?: boolean;
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
        res
          .status(400)
          .json({ error: 'payload.pantry must be an array of strings' });
        return;
      }

      const pantry = uniqueStrings(
        pantryRaw.map((x) => String(x || '').trim()).filter(Boolean),
      );

      if (!pantry.length) {
        res.status(400).json({ error: 'Pantry cannot be empty' });
        return;
      }

      const ideaCount = sanitizeIdeaCount(body.constraints?.ideaCount);
      const requestedIdeaCount = inflateIdeaCountForGeneration(
        ideaCount,
        body.constraints?.preferRealRecipes === true,
      );

      const maxMissing = sanitizeMaxMissing(body.constraints?.maxMissing);
      const time = sanitizeTime(body.constraints?.time);

      const cuisines = Array.isArray(body.constraints?.cuisines)
        ? uniqueStrings(
            body.constraints.cuisines
              .map((x) => String(x || '').trim())
              .filter(Boolean),
          ).slice(0, 10)
        : [];

      const starIngredient =
        String(body.constraints?.starIngredient || '').trim() || null;

      const preferRealRecipes = body.constraints?.preferRealRecipes === true;
      const userPrompt = String(body.userPrompt || '').trim();

      const system =
        String(body.system || '').trim() ||
        [
          'You are a culinary assistant.',
          'Respect halal; avoid alcohol.',
          'Keep steps concise, practical, and reproducible.',
          'Prefer genuine named dishes over vague descriptive titles whenever a real dish clearly fits.',
        ].join(' ');

      const outputRules = buildOutputRules({
        pantry,
        requestedIdeaCount,
        ideaCount,
        maxMissing,
        time,
        cuisines,
        starIngredient,
        preferRealRecipes,
      });

      const client = new OpenAI({
        apiKey: OPENAI_API_KEY.value(),
      });

      const completion = await client.chat.completions.create({
        model: 'gpt-5.4',
        temperature: preferRealRecipes ? 0.35 : 0.7,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [userPrompt, outputRules].filter(Boolean).join('\n\n'),
          },
        ],
      });

      const text = completion.choices?.[0]?.message?.content || '[]';

      const parsed = parseIdeasFromModel(text)
        .map(normalizeIdea)
        .filter(
          (idea) => idea.title && idea.ingredients.length && idea.steps.length,
        );

      const ideas = postProcessIdeas(parsed, {
        ideaCount,
        preferRealRecipes,
      });

      res.json({ ideas });
    } catch (err: any) {
      console.error('[generateIdeas]', err);
      res.status(500).json({ error: err?.message ?? 'LLM error' });
    }
  },
);

function buildOutputRules(args: {
  pantry: string[];
  requestedIdeaCount: number;
  ideaCount: number;
  maxMissing: 0 | 1 | 2;
  time: number | null;
  cuisines: string[];
  starIngredient: string | null;
  preferRealRecipes: boolean;
}): string {
  const firstLine = args.preferRealRecipes
    ? `Return ONLY a JSON array with up to ${args.requestedIdeaCount} items.`
    : `Return ONLY a JSON array with exactly ${args.requestedIdeaCount} items.`;

  return `
${firstLine}

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
- Ingredients should be simple strings only, no quantities.
- Steps must be concise, practical, and 4 to 7 items long.
- If a dish corresponds to a real established recipe, use its proper canonical name instead of a generic description.
- Example: use "Aglio e Olio", not "pasta with garlic and olive oil".
- Example: use "Menemen", not "eggs with tomato and peppers".
- Example: use "Tufahija", not "apple walnut dessert".
- Example: use "Melanzane alla Parmigiana", not "fried eggplant with parmesan".
- ${
    args.preferRealRecipes
      ? [
          'Real existing named dishes are REQUIRED whenever plausibly possible.',
          'Do NOT invent filler titles.',
          'Do NOT use vague descriptive titles like Bowl, Skillet, Plate, One-Pot, Comfort, Home-Style, Weeknight, Quick, Easy, Fresh, or Hearty unless that wording is truly the canonical dish name.',
          'When a canonical named dish fits, use that named dish.',
          `It is better to return fewer than ${args.requestedIdeaCount} items than to pad the answer with generic invented recipes.`,
        ].join(' ')
      : 'Real named dishes are welcome when they fit, but non-canonical ideas are also allowed.'
  }
- Output raw JSON only.
- Do not include markdown.
- Do not include commentary.
- Do not include code fences.
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
            .filter(Boolean),
        )
      : [],
    steps: Array.isArray(raw?.steps)
      ? raw.steps.map((x: any) => String(x || '').trim()).filter(Boolean)
      : [],
  };
}

function postProcessIdeas(
  ideas: LlmIdea[],
  opts: {
    ideaCount: number;
    preferRealRecipes: boolean;
  },
): LlmIdea[] {
  let out = dedupeIdeasByTitle(ideas);

  if (opts.preferRealRecipes) {
    const nonGeneric = out.filter(
      (idea) => !isObviouslyGenericTitle(idea.title),
    );

    const rankedPrimary = (nonGeneric.length ? nonGeneric : out)
      .map((idea) => ({
        idea,
        score: scoreRealRecipeLikelihood(idea),
      }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.idea);

    out = dedupeIdeasByTitle(rankedPrimary);
  }

  return out.slice(0, opts.ideaCount);
}

function dedupeIdeasByTitle(ideas: LlmIdea[]): LlmIdea[] {
  const seen = new Set<string>();
  const out: LlmIdea[] = [];

  for (const idea of ideas) {
    const key = normalizeTitleKey(idea.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(idea);
  }

  return out;
}

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

function isObviouslyGenericTitle(title: string): boolean {
  const t = normalizeTitleKey(title);

  return /\b(bowl|skillet|plate|one-pot|one pot|comfort|home-style|homestyle|weeknight|quick|easy|fresh|hearty|pantry)\b/.test(
    t,
  );
}

function scoreRealRecipeLikelihood(idea: LlmIdea): number {
  const title = normalizeTitleKey(idea.title);
  const words = title.split(' ').filter(Boolean);
  let score = 0;

  if (isObviouslyGenericTitle(title)) score -= 100;

  if (words.length >= 1 && words.length <= 4) score += 2;
  if (words.length >= 5) score -= 0.75;

  if (/\b(al|alla|allo|ai|con|di|de|del|della|au|à)\b/.test(title)) {
    score += 1.25;
  }

  const canonicalDishHints = [
    'aglio e olio',
    'menemen',
    'tufahija',
    'parmigiana',
    'lasagna',
    'lasagne',
    'risotto',
    'biryani',
    'pilaf',
    'pilav',
    'paella',
    'shakshuka',
    'tarator',
    'chorba',
    'corba',
    'çorbası',
    'jambalaya',
    'kedgeree',
    'khichdi',
    'fried rice',
    'arroz',
    'congee',
    'oyakodon',
    'tagine',
    'curry',
  ];

  if (canonicalDishHints.some((hint) => title.includes(hint))) {
    score += 2.5;
  }

  if (/\b(with|and)\b/.test(title) && words.length >= 5) {
    score -= 1;
  }

  if (idea.steps.length >= 4 && idea.steps.length <= 7) score += 0.5;

  return score;
}

function inflateIdeaCountForGeneration(
  ideaCount: number,
  preferRealRecipes: boolean,
): number {
  if (!preferRealRecipes) return ideaCount;
  return Math.min(18, Math.max(8, ideaCount * 3));
}

function sanitizeIdeaCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 3;
  return Math.max(1, Math.min(12, Math.round(num)));
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
