import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

import { PantryRepo } from './pantry.repo';
import { IdeasRepo } from './ideas.repo';
import { Idea } from '../models/idea.model';
import { IdeaIngredient } from '../models/idea-ingredient.model';
import { environment } from '../../environments/environment';

export interface GenerateParams {
  prompt: string;
  maxMissing: 0 | 1 | 2;
  time: number | null;
  cuisines: string[];
  starIngredient: string | null;
}

type RawIdea = {
  title: string;
  ingredients: string[];
  steps: string[];
};

type ScoredIdeaBundle = {
  idea: Idea;
  ingredients: IdeaIngredient[];
};

@Injectable({ providedIn: 'root' })
export class IdeaEngineService {
  private pantry = inject(PantryRepo);
  private ideas = inject(IdeasRepo);
  private http = inject(HttpClient);

  async generateAndSave(params: GenerateParams): Promise<string[]> {
    const pantryItems = await firstValueFrom(this.pantry.list$());
    const pantryNames = this.cleanPantryNames(
      pantryItems.map((p) => (p.name || '').trim()).filter(Boolean),
    );

    if (!pantryNames.length) {
      throw new Error('Your pantry is empty. Add a few items first.');
    }

    const payload = this.buildPayload(pantryNames, params);

    const rawIdeas = await this.generateRawIdeas(payload, params, pantryNames);
    const scored = this.scoreAndGroup(rawIdeas, pantryNames, params.maxMissing);

    await this.ideas.keepLatest(0);

    const ids: string[] = [];
    for (const entry of scored) {
      const id = await this.ideas.upsertIdeaWithIngredients(
        null,
        entry.idea as any,
        entry.ingredients,
      );
      ids.push(id);
    }

    return ids;
  }

  private buildPayload(pantry: string[], p: GenerateParams) {
    return {
      system:
        'You are a culinary assistant. Respect halal; avoid alcohol. Keep steps concise, useful, and reproducible.',
      constraints: {
        maxMissing: p.maxMissing,
        time: p.time,
        cuisines: p.cuisines,
        starIngredient: p.starIngredient,
      },
      userPrompt: (p.prompt || '').trim(),
      pantry,
    };
  }

  private async generateRawIdeas(
    payload: any,
    params: GenerateParams,
    pantryNames: string[],
  ): Promise<RawIdea[]> {
    const endpoint = environment['llmEndpoint'];
    const useMock = !!environment['useIdeaMock'];

    if (!endpoint) {
      if (useMock) {
        return this.localMock(params, pantryNames);
      }
      throw new Error('LLM endpoint is not configured.');
    }

    try {
      return await this.callRemote(endpoint, payload);
    } catch (err) {
      if (useMock) {
        console.warn(
          '[IdeaEngineService] Remote generation failed. Falling back to local mock.',
          err,
        );
        return this.localMock(params, pantryNames);
      }
      throw err;
    }
  }

  private async callRemote(endpoint: string, payload: any): Promise<RawIdea[]> {
    try {
      const res = await firstValueFrom(this.http.post<any>(endpoint, payload));
      const arr = Array.isArray(res) ? res : (res?.ideas ?? []);

      return arr
        .map((r: any) => this.normalizeRawIdea(r))
        .filter(
          (r: RawIdea) => r.title && r.ingredients.length && r.steps.length,
        )
        .slice(0, 12);
    } catch (e: any) {
      const status = e?.status || e?.response?.status;
      const msg = e?.error?.error || e?.message || 'LLM request failed';
      throw new Error(`${status || ''} ${msg}`.trim());
    }
  }

  private normalizeRawIdea(r: any): RawIdea {
    return {
      title: String(r?.title || '').trim(),
      ingredients: Array.isArray(r?.ingredients)
        ? this.uniqueStrings(
            r.ingredients
              .map((x: any) => String(x || '').trim())
              .filter(Boolean),
          )
        : [],
      steps: Array.isArray(r?.steps)
        ? r.steps.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [],
    };
  }

  private async localMock(
    p: GenerateParams,
    pantry: string[],
  ): Promise<RawIdea[]> {
    const star = p.starIngredient?.trim() || null;
    const leadCuisine = p.cuisines[0] || null;

    const picks = (count: number): string[] => {
      const preferred = star ? [star] : [];
      const pool = pantry.filter((x) => !preferred.includes(x));
      const out = [...preferred];

      for (const item of pool) {
        if (out.length >= count) break;
        out.push(item);
      }

      return this.uniqueStrings(out).slice(0, count);
    };

    return [
      {
        title: star ? `${star} skillet plate` : 'Quick pantry skillet',
        ingredients: picks(5),
        steps: [
          'Prep the ingredients into bite-sized pieces.',
          'Cook the main base ingredient first until lightly colored.',
          'Add the remaining ingredients in stages so they keep texture.',
          'Season and adjust moisture with a small splash of water if needed.',
          'Serve hot.',
        ],
      },
      {
        title: leadCuisine
          ? `${leadCuisine} comfort bowl`
          : 'Comfort pantry bowl',
        ingredients: picks(6),
        steps: [
          'Build a simple flavor base with the strongest pantry ingredients.',
          'Cook the main body of the dish until cohesive.',
          'Add quick-cooking ingredients near the end.',
          'Taste and adjust salt, acidity, and richness.',
          'Plate and finish simply.',
        ],
      },
      {
        title: 'One-pan home meal',
        ingredients: picks(5),
        steps: [
          'Heat the pan and start with the ingredient that needs the longest cooking.',
          'Layer in the remaining ingredients gradually.',
          'Keep the heat moderate so nothing burns.',
          'Bring the flavors together with seasoning.',
          'Serve once everything is cooked through.',
        ],
      },
    ];
  }

  private scoreAndGroup(
    raw: RawIdea[],
    pantry: string[],
    maxMissing: 0 | 1 | 2,
  ): ScoredIdeaBundle[] {
    const pantryExact = new Set(
      pantry.map((n) => this.normalizeIngredientName(n)),
    );
    const pantryLoose = pantry.map((n) => this.normalizeIngredientName(n));

    const bundles: ScoredIdeaBundle[] = [];

    for (const r of raw) {
      const used: IdeaIngredient[] = [];
      let missing = 0;
      let coverage = 0;

      for (const ingName of r.ingredients) {
        const normalizedIng = this.normalizeIngredientName(ingName);
        const has = this.matchesPantry(normalizedIng, pantryExact, pantryLoose);

        const ing: IdeaIngredient = {
          id:
            normalizedIng.replace(/\W+/g, '_').slice(0, 40) ||
            Math.random().toString(36).slice(2),
          name: ingName,
          isMissing: !has,
        };

        if (has) {
          (ing as any).matchedQuantity = 1;
          (ing as any).matchScore = 1;
        }

        used.push(ing);

        if (has) {
          coverage++;
        } else {
          missing++;
        }
      }

      if (!used.length) continue;
      if (missing > maxMissing) continue;

      const missingCount = Math.min(missing, 2);
      const readinessTier =
        missingCount === 0 ? 'READY' : missingCount === 1 ? 'N1' : 'N2';

      const coverageScore = coverage / used.length;
      const stepCount = r.steps.length || 1;
      const structureScore = Math.min(1, stepCount / 5);
      const totalScore = +(
        coverageScore * 0.88 +
        structureScore * 0.12
      ).toFixed(4);

      const description = this.buildDescription(r.ingredients, r.steps);

      const idea: any = {
        id: 'tmp',
        prompt: '',
        title: r.title,
        createdAt: null as any,
        updatedAt: null as any,
        missingCount,
        readinessTier,
        totalScore,
        scoreBreakdown: {
          pantryCoverage: coverageScore,
          structureScore,
        },
        allowSubstitutions: true,
        description,
      };

      bundles.push({
        idea: idea as Idea,
        ingredients: used,
      });
    }

    bundles.sort((a, b) => b.idea.totalScore - a.idea.totalScore);
    return bundles;
  }

  private buildDescription(ingredients: string[], steps: string[]): string {
    const ingredientLines = ingredients.map((x) => `• ${x}`);
    const stepLines = steps.map((s, i) => `${i + 1}. ${s}`);

    return [
      'Ingredients:',
      ...ingredientLines,
      '',
      'Steps:',
      ...stepLines,
    ].join('\n');
  }

  private cleanPantryNames(names: string[]): string[] {
    return this.uniqueStrings(names.map((x) => x.trim()).filter(Boolean));
  }

  private uniqueStrings(values: string[]): string[] {
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

  private normalizeIngredientName(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[()[\],]/g, ' ')
      .replace(/\b\d+([.,]\d+)?\s*(g|kg|ml|l)\b/g, ' ')
      .replace(/\b(clove|cloves|piece|pieces|pc|pcs|tbsp|tsp)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private matchesPantry(
    ingredient: string,
    pantryExact: Set<string>,
    pantryLoose: string[],
  ): boolean {
    if (!ingredient) return false;
    if (pantryExact.has(ingredient)) return true;

    return pantryLoose.some(
      (p) => p.includes(ingredient) || ingredient.includes(p),
    );
  }
}
