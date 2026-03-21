import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import OpenAI from "openai";

// Use Firebase Secret Manager
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

export const generateIdeas = onRequest(
  {
    region: "europe-west1",              // close to you in Skopje
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [OPENAI_API_KEY],
  },
  async (req, res) => {
    // --- Minimal CORS (Angular dev & prod) ---
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "content-type");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Use POST" });
      return;
    }

    try {
      // Expecting the same payload our IdeaEngineService sends:
      // { system?, constraints: { maxMissing, time, cuisines, starIngredient }, userPrompt, pantry: string[] }
      const { system, constraints, userPrompt, pantry } = req.body ?? {};
      if (!Array.isArray(pantry)) {
        res.status(400).json({ error: "payload.pantry must be an array of strings" });
        return;
      }

      const sys =
        system ||
        "You are a culinary assistant. Respect halal; avoid alcohol. Keep steps concise and reproducible.";

      const maxMissing = Number(constraints?.maxMissing ?? 1);
      const time = constraints?.time ?? null;
      const cuisines: string[] = Array.isArray(constraints?.cuisines) ? constraints.cuisines : [];
      const star = constraints?.starIngredient ?? null;

      // Build strict JSON instructions (no markdown, no prose)
      const outputRules = `
Return ONLY a JSON array of 6 items, each:
{
  "title": string,
  "ingredients": string[],
  "steps": string[]
}
Rules:
- Use pantry items when possible: ${pantry.join(", ")}.
- Allow at most ${maxMissing} missing items overall per idea.
- ${time ? `Aim for <= ${time} minutes.` : "Time: any."}
- Favor cuisines: ${cuisines.length ? cuisines.join(", ") : "any"}.
- ${star ? `Center around: ${star}.` : "No specific star ingredient."}
- 5–7 precise, reproducible steps.
- No commentary, no code fences, no markdown — only raw JSON array.`;

      const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });

      // Using Chat Completions for simplicity; widely supported in the Node SDK.
      // (OpenAI’s official quickstart uses this style with Node.) :contentReference[oaicite:1]{index=1}
      const completion = await client.chat.completions.create({
        model: "gpt-gpt-5.4",
        temperature: 0.7,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `${userPrompt || ""}\n\n${outputRules}` },
        ],
      });

      const text = completion.choices?.[0]?.message?.content || "[]";

      // Be robust to accidental code fences
      const cleaned = text.replace(/^```json\s*|\s*```$/g, "");
      let ideas: any[] = [];
      try {
        ideas = JSON.parse(cleaned);
      } catch {
        // As a last resort, try to find the first JSON array
        const m = cleaned.match(/\[[\s\S]*\]/);
        ideas = m ? JSON.parse(m[0]) : [];
      }

      // Normalize shape a bit
      ideas = (ideas || [])
        .map((r: any) => ({
          title: String(r?.title || "").trim(),
          ingredients: Array.isArray(r?.ingredients)
            ? r.ingredients.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [],
          steps: Array.isArray(r?.steps)
            ? r.steps.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [],
        }))
        .filter((r: any) => r.title && r.ingredients.length);

      res.json(ideas);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err?.message ?? "LLM error" });
    }
  }
);
