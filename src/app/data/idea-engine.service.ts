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
  ideaCount: 1 | 2 | 3 | 5;
  maxMissing: 0 | 1 | 2;
  time: number | null;
  cuisines: string[];
  starIngredient: string | null;
  preferRealRecipes: boolean;
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
        'You are a culinary assistant. Respect halal; avoid alcohol. Keep steps concise, useful, and reproducible. Use natural, appetizing dish titles and avoid awkward generic phrasing.',
      constraints: {
        ideaCount: p.ideaCount,
        maxMissing: p.maxMissing,
        time: p.time,
        cuisines: p.cuisines,
        starIngredient: p.starIngredient,
        preferRealRecipes: p.preferRealRecipes,
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
      return await this.callRemote(endpoint, payload, params.ideaCount);
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

  private async callRemote(
    endpoint: string,
    payload: any,
    maxIdeas: number,
  ): Promise<RawIdea[]> {
    try {
      const res = await firstValueFrom(this.http.post<any>(endpoint, payload));
      const arr = Array.isArray(res) ? res : (res?.ideas ?? []);

      return arr
        .map((r: any) => this.normalizeRawIdea(r))
        .filter(
          (r: RawIdea) => r.title && r.ingredients.length && r.steps.length,
        )
        .slice(0, maxIdeas);
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
    const count = p.ideaCount || 3;

    if (p.preferRealRecipes) {
      return this.buildRealRecipeMockCatalog().slice(0, count);
    }

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

    const titleTemplates = [
      () => (star ? `${star} skillet plate` : 'Quick pantry skillet'),
      () =>
        leadCuisine ? `${leadCuisine} comfort bowl` : 'Comfort pantry bowl',
      () => 'One-pan home meal',
      () => 'Simple pantry plate',
      () => 'Weeknight comfort dish',
      () => 'Fast stovetop meal',
      () => 'Pantry dinner idea',
      () => 'Cozy one-pan supper',
      () => 'Home-style quick plate',
      () => 'Simple comfort bowl',
      () => 'Easy family dinner',
      () => 'Quick savory plate',
    ];

    const stepTemplates = [
      [
        'Prep the ingredients into bite-sized pieces.',
        'Cook the main base ingredient first until lightly colored.',
        'Add the remaining ingredients in stages so they keep texture.',
        'Season and adjust moisture with a small splash of water if needed.',
        'Serve hot.',
      ],
      [
        'Build a simple flavor base with the strongest pantry ingredients.',
        'Cook the main body of the dish until cohesive.',
        'Add quick-cooking ingredients near the end.',
        'Taste and adjust salt, acidity, and richness.',
        'Plate and finish simply.',
      ],
      [
        'Heat the pan and start with the ingredient that needs the longest cooking.',
        'Layer in the remaining ingredients gradually.',
        'Keep the heat moderate so nothing burns.',
        'Bring the flavors together with seasoning.',
        'Serve once everything is cooked through.',
      ],
    ];

    return Array.from({ length: count }, (_, index) => ({
      title: titleTemplates[index % titleTemplates.length](),
      ingredients: picks(index % 2 === 0 ? 5 : 6),
      steps: stepTemplates[index % stepTemplates.length],
    }));
  }

  private buildRealRecipeMockCatalog(): RawIdea[] {
    return [
      {
        title: 'Aglio e Olio',
        ingredients: [
          'spaghetti',
          'garlic',
          'olive oil',
          'chili flakes',
          'parsley',
        ],
        steps: [
          'Cook the spaghetti until al dente.',
          'Gently warm the garlic in olive oil without browning it too much.',
          'Add chili flakes and a small splash of pasta water.',
          'Toss the spaghetti through the sauce until glossy.',
          'Finish with parsley and serve immediately.',
        ],
      },
      {
        title: 'Menemen',
        ingredients: [
          'eggs',
          'tomatoes',
          'green peppers',
          'butter',
          'olive oil',
        ],
        steps: [
          'Soften the peppers in butter and olive oil.',
          'Add chopped tomatoes and cook until jammy.',
          'Lightly season and reduce the mixture a little.',
          'Add beaten eggs and stir gently until softly set.',
          'Serve hot with bread.',
        ],
      },
      {
        title: 'Yayla Çorbası',
        ingredients: ['yogurt', 'rice', 'egg', 'butter', 'mint'],
        steps: [
          'Cook the rice until tender in water.',
          'Whisk yogurt and egg until smooth.',
          'Temper the yogurt mixture with some hot liquid.',
          'Return it to the pot and cook gently without boiling hard.',
          'Finish with butter and dried mint.',
        ],
      },
      {
        title: 'Tufahija',
        ingredients: ['apples', 'walnuts', 'sugar', 'cinnamon', 'lemon'],
        steps: [
          'Peel and core the apples carefully.',
          'Poach them gently in sweetened water with lemon.',
          'Cook until just tender but still holding shape.',
          'Fill the centers with walnuts.',
          'Serve cooled with a little syrup.',
        ],
      },
      {
        title: 'Melanzane alla Parmigiana',
        ingredients: [
          'eggplant',
          'pomodoro sauce',
          'parmesan',
          'olive oil',
          'basil',
        ],
        steps: [
          'Slice and cook the eggplant until softened and lightly golden.',
          'Spread a little sauce in a baking dish.',
          'Layer eggplant, sauce, parmesan, and basil.',
          'Repeat the layers and finish with parmesan on top.',
          'Bake until bubbling and settled.',
        ],
      },
      {
        title: 'Bruschetta al Pomodoro',
        ingredients: ['bread', 'tomatoes', 'garlic', 'olive oil', 'basil'],
        steps: [
          'Toast or grill the bread until crisp.',
          'Rub the warm bread with garlic.',
          'Mix chopped tomatoes with olive oil and basil.',
          'Spoon the tomato mixture over the bread.',
          'Serve right away.',
        ],
      },
      {
        title: 'Şakşuka',
        ingredients: ['eggplant', 'tomatoes', 'garlic', 'olive oil', 'peppers'],
        steps: [
          'Cook the eggplant until tender and lightly colored.',
          'Prepare a tomato-pepper-garlic sauce in olive oil.',
          'Simmer until the sauce thickens slightly.',
          'Top the eggplant with the sauce.',
          'Serve warm or at room temperature.',
        ],
      },
      {
        title: 'Cacık',
        ingredients: ['yogurt', 'cucumber', 'garlic', 'olive oil', 'mint'],
        steps: [
          'Grate or finely chop the cucumber.',
          'Mix it with yogurt and crushed garlic.',
          'Thin slightly if needed for the texture you want.',
          'Finish with olive oil and mint.',
          'Serve chilled.',
        ],
      },
      {
        title: 'Pasta al Pomodoro',
        ingredients: [
          'pasta',
          'pomodoro sauce',
          'garlic',
          'olive oil',
          'basil',
        ],
        steps: [
          'Cook the pasta until al dente.',
          'Warm garlic gently in olive oil.',
          'Add pomodoro sauce and simmer briefly.',
          'Toss the pasta with the sauce and a little pasta water.',
          'Finish with basil and serve.',
        ],
      },
      {
        title: 'Patatas Bravas',
        ingredients: [
          'potatoes',
          'pomodoro sauce',
          'garlic',
          'olive oil',
          'paprika',
        ],
        steps: [
          'Cook the potatoes until crisp outside and soft inside.',
          'Prepare a simple spicy tomato sauce with garlic and paprika.',
          'Season the potatoes well.',
          'Spoon the sauce over or alongside them.',
          'Serve hot.',
        ],
      },
      {
        title: 'Tarator',
        ingredients: ['yogurt', 'cucumber', 'garlic', 'walnuts', 'olive oil'],
        steps: [
          'Finely chop or grate the cucumber.',
          'Mix with yogurt and crushed garlic.',
          'Add crushed walnuts for body.',
          'Finish with olive oil and a little seasoning.',
          'Serve cold.',
        ],
      },
      {
        title: 'Shakshuka',
        ingredients: ['eggs', 'tomatoes', 'peppers', 'onion', 'olive oil'],
        steps: [
          'Soften onion and peppers in olive oil.',
          'Add tomatoes and cook until rich and thick.',
          'Make small wells in the sauce.',
          'Crack in the eggs and cook until just set.',
          'Serve directly from the pan.',
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

    const bundles: ScoredIdeaBundle[] = [];

    for (const r of raw) {
      const used: IdeaIngredient[] = [];
      let missing = 0;
      let coverage = 0;

      for (const ingName of r.ingredients) {
        const normalizedIng = this.normalizeIngredientName(ingName);
        const has = this.matchesPantry(normalizedIng, pantryExact);

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

      const realRecipeScore = this.scoreRealRecipeLikelihood(r.title);
      const totalScore = +(
        coverageScore * 0.78 +
        structureScore * 0.1 +
        realRecipeScore * 0.12
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
          preferenceFit: realRecipeScore,
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
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[()[\],]/g, ' ')
      .replace(/[’']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private matchesPantry(ingredient: string, pantryExact: Set<string>): boolean {
    return !!ingredient && pantryExact.has(ingredient);
  }

  private normalizeTitleKey(title: string): string {
    return String(title || '')
      .toLowerCase()
      .trim()
      .replace(/[’']/g, '')
      .replace(/\s+/g, ' ');
  }

  private isObviouslyGenericTitle(title: string): boolean {
    const t = this.normalizeTitleKey(title);

    return /\b(bowl|skillet|plate|one-pot|one pot|comfort|home-style|homestyle|weeknight|quick|easy|fresh|hearty|pantry)\b/.test(
      t,
    );
  }

  private scoreRealRecipeLikelihood(title: string): number {
    const t = this.normalizeTitleKey(title);
    const words = t.split(' ').filter(Boolean);

    let score = 0.5;

    if (this.isObviouslyGenericTitle(t)) score -= 0.45;

    if (words.length >= 1 && words.length <= 4) score += 0.12;
    if (words.length >= 5) score -= 0.06;

    if (/\b(al|alla|allo|ai|con|di|de|del|della|au|à)\b/.test(t)) {
      score += 0.08;
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
      'hainanese chicken rice',
    ];

    if (canonicalDishHints.some((hint) => t.includes(hint))) {
      score += 0.28;
    }

    if (/\b(with|and)\b/.test(t) && words.length >= 5) {
      score -= 0.08;
    }

    return Math.max(0, Math.min(1, score));
  }
}
