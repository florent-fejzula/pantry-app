import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PantryRepo } from './pantry.repo';
import { IdeasRepo } from './ideas.repo';
import { Idea } from '../models/idea.model';
import { IdeaIngredient } from '../models/idea-ingredient.model';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface GenerateParams {
  prompt: string;             // free text
  maxMissing: 0 | 1 | 2;
  time: number | null;        // minutes, null = any
  cuisines: string[];         // optional
  starIngredient: string | null;
}

@Injectable({ providedIn: 'root' })
export class IdeaEngineService {
  private pantry = inject(PantryRepo);
  private ideas = inject(IdeasRepo);
  private http = inject(HttpClient);

  async generateAndSave(params: GenerateParams): Promise<string[]> {
    // 1) Snapshot pantry (names only, minimal)
    const pantryItems = await firstValueFrom(this.pantry.list$());
    const pantryNames = pantryItems.map(p => (p.name || '').trim()).filter(Boolean);

    // 2) Build payload
    const payload = this.buildPayload(pantryNames, params);

    // 3) Call LLM (remote if configured) or fallback to local mock on error
    let rawIdeas: Array<{ title: string; ingredients: string[]; steps: string[] }>;
    try {
      rawIdeas = environment['llmEndpoint']
        ? await this.callRemote(environment['llmEndpoint'], payload)
        : await this.localMock(params, pantryNames);
    } catch (err) {
      console.warn('[IdeaEngineService] remote failed, using mock:', err);
      rawIdeas = await this.localMock(params, pantryNames);
    }

    // 4) Score + group
    const { ideas, ingredientsByIdea } = this.scoreAndGroup(rawIdeas, pantryNames, params.maxMissing);

    await this.ideas.keepLatest(0); // remove all previous (uses createdAt)

    // 5) Save to Firestore (ideas + ingredients)
    const ids: string[] = [];
    for (const i of ideas) {
      const ing = ingredientsByIdea[i.title] ?? [];
      const id = await this.ideas.upsertIdeaWithIngredients(null, i as any, ing);
      ids.push(id);
    }
    return ids;
  }

  private buildPayload(pantry: string[], p: GenerateParams) {
    return {
      system: 'You are a culinary assistant. Respect halal; avoid alcohol.',
      constraints: {
        maxMissing: p.maxMissing,
        time: p.time,
        cuisines: p.cuisines,
        starIngredient: p.starIngredient
      },
      userPrompt: p.prompt,
      pantry // names only
    };
  }

  // --- Remote call (plug your Cloud Function / API here) ---
  private async callRemote(endpoint: string, payload: any): Promise<Array<{title:string; ingredients:string[]; steps:string[];}>> {
    try {
      const res = await firstValueFrom(this.http.post<any>(endpoint, payload));
      const arr = Array.isArray(res) ? res : res?.ideas ?? [];
      return arr
        .map((r: any) => ({
          title: String(r.title || '').trim(),
          ingredients: (r.ingredients || []).map((x: any) => String(x || '').trim()).filter(Boolean),
          steps: (r.steps || []).map((x: any) => String(x || '').trim()).filter(Boolean),
        }))
        .filter((r: any) => r.title && r.ingredients?.length);
    } catch (e: any) {
      const status = e?.status || e?.response?.status;
      const msg = e?.error?.error || e?.message || 'LLM request failed';
      throw new Error(`${status || ''} ${msg}`.trim());
    }
  }

  // --- Local mock (until you wire a real endpoint) ---
  private async localMock(p: GenerateParams, pantry: string[]) {
    const base = p.starIngredient ? [p.starIngredient] : [];
    const picks = (n: number) => {
      const pool = pantry.filter(x => !base.includes(x));
      const out: string[] = [...base];
      while (out.length < Math.min(n, pantry.length)) {
        const rand = pool[Math.floor(Math.random() * pool.length)];
        if (rand && !out.includes(rand)) out.push(rand);
        if (out.length > 8) break;
      }
      return out;
    };

    return [
      { title: 'Quick ' + (p.starIngredient ?? 'Pantry') + ' Bowl', ingredients: picks(4), steps: ['Mix & cook.','Season to taste.'] },
      { title: 'Warm ' + (p.cuisines[0] ?? 'Home') + ' Skillet', ingredients: picks(5), steps: ['Sauté base.','Finish and serve.'] },
      { title: 'Hearty One-Pot', ingredients: picks(6), steps: ['Combine.','Simmer.'] },
      { title: 'Fresh Salad Plate', ingredients: picks(5), steps: ['Chop.','Dress.'] },
      { title: 'Comfort Bake', ingredients: picks(6), steps: ['Assemble.','Bake.'] },
      { title: 'Spiced Pilaf', ingredients: picks(5), steps: ['Toast grain.','Steam.'] },
    ];
  }

  // --- Scoring & grouping (READY / N1 / N2) ---
  private scoreAndGroup(
    raw: Array<{ title: string; ingredients: string[]; steps: string[] }>,
    pantry: string[],
    maxMissing: 0 | 1 | 2
  ): { ideas: Idea[]; ingredientsByIdea: Record<string, IdeaIngredient[]> } {

    const pantrySet = new Set(pantry.map(n => n.toLowerCase()));

    const outIdeas: Idea[] = [];
    const ingMap: Record<string, IdeaIngredient[]> = {};

    for (const r of raw) {
      const used: IdeaIngredient[] = [];
      let missing = 0;
      let coverage = 0;

      for (const ingName of r.ingredients) {
        const key = ingName.toLowerCase();
        const has = pantrySet.has(key);

        const ing: IdeaIngredient = {
          id: key.replace(/\W+/g, '_').slice(0, 40) || Math.random().toString(36).slice(2),
          name: ingName,
          isMissing: !has
        };
        if (has) {
          (ing as any).matchedQuantity = 1;
          (ing as any).matchScore = 1;
        }
        used.push(ing);

        if (has) coverage++; else missing++;
      }

      if (missing > maxMissing) continue;

      const missingCount = Math.min(missing, 2);
      const readinessTier = missingCount === 0 ? 'READY' : missingCount === 1 ? 'N1' : 'N2';

      const coverageScore = used.length ? coverage / used.length : 0;
      const stepPenalty = Math.min(1, (r.steps?.length ?? 0) / 10);
      const totalScore = +(coverageScore * 0.9 + (1 - stepPenalty) * 0.1).toFixed(4);

      const desc = r.steps?.length ? r.steps.join('\n') : undefined;

      const idea: any = {
        id: 'tmp',
        prompt: '',                 // keep as empty string, not undefined
        title: r.title,
        createdAt: null as any,     // repo sets serverTimestamp on write
        updatedAt: null as any,
        missingCount,
        readinessTier,
        totalScore,
        scoreBreakdown: { pantryCoverage: coverageScore },
        allowSubstitutions: true
      };
      if (desc) idea.description = desc;

      outIdeas.push(idea as Idea);
      ingMap[r.title] = used;
    }

    outIdeas.sort((a, b) => b.totalScore - a.totalScore);
    return { ideas: outIdeas, ingredientsByIdea: ingMap };
  }
}
