import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';

import { PantryRepo } from '../../data/pantry.repo';
import { IdeasRepo } from '../../data/ideas.repo';
import {
  IdeaEngineService,
  GenerateParams,
} from '../../data/idea-engine.service';

import { map, startWith } from 'rxjs';
import { ResultsComponent } from '../results/results.component';

@Component({
  selector: 'app-ideas',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ResultsComponent],
  templateUrl: './ideas.component.html',
  styleUrls: ['./ideas.component.scss'],
})
export class IdeasComponent {
  private pantry = inject(PantryRepo);
  private repo = inject(IdeasRepo);
  private engine = inject(IdeaEngineService);

  readonly predefinedCuisines = [
    'Turkish',
    'Levant',
    'Italian',
    'Balkan',
    'Mexican',
    'Indian',
    'East Asian',
  ] as const;

  readonly ideaCountOptions = [1, 2, 3, 5] as const;

  /** Free-text prompt */
  prompt = new FormControl<string>('', { nonNullable: true });

  /** Filters */
  ideaCount = signal<1 | 2 | 3 | 5>(3);
  maxMissing = signal<0 | 1 | 2>(1);
  time = signal<number | null>(null);
  cuisines = signal<string[]>([]);
  preferRealRecipes = signal(false);

  /** Custom cuisine input */
  customCuisineInput = new FormControl<string>('', { nonNullable: true });

  /** Star ingredient */
  starInput = new FormControl<string>('', { nonNullable: true });
  starIngredient = signal<string | null>(null);

  /** UI state */
  loading = signal(false);
  error = signal<string | null>(null);
  generatedOnce = signal(false);

  /** Pantry names for suggestions (datalist) */
  pantryNames$ = this.pantry.list$().pipe(
    map((items) =>
      items
        .map((i) => (i.name || '').trim())
        .filter(Boolean)
        .sort(),
    ),
    startWith([] as string[]),
  );

  /** Ideas stream (live) — passed to <app-results> */
  ideas$ = this.repo.list$();

  hasCuisine(cuisine: string): boolean {
    const target = this.normalizeText(cuisine);
    return this.cuisines().some((c) => this.normalizeText(c) === target);
  }

  toggleCuisine(cuisine: string) {
    const value = this.cleanCuisine(cuisine);
    if (!value) return;

    if (this.hasCuisine(value)) {
      this.removeCuisine(value);
      return;
    }

    this.cuisines.set([...this.cuisines(), value]);
  }

  addCustomCuisineFromInput() {
    const value = this.cleanCuisine(this.customCuisineInput.value);
    if (!value) return;

    if (!this.hasCuisine(value)) {
      this.cuisines.set([...this.cuisines(), value]);
    }

    this.customCuisineInput.setValue('');
  }

  removeCuisine(cuisine: string) {
    const target = this.normalizeText(cuisine);
    this.cuisines.set(
      this.cuisines().filter((c) => this.normalizeText(c) !== target),
    );
  }

  setStarFromInput() {
    const v = this.starInput.value.trim();
    if (!v) return;
    this.starIngredient.set(v);
  }

  clearStar() {
    this.starIngredient.set(null);
    this.starInput.setValue('');
  }

  async generate() {
    this.error.set(null);
    this.loading.set(true);

    try {
      // Friendly UX: if user typed a custom cuisine but forgot to press Add,
      // we still include it.
      this.addCustomCuisineFromInput();

      const params: GenerateParams = {
        prompt: this.prompt.value.trim(),
        ideaCount: this.ideaCount(),
        maxMissing: this.maxMissing(),
        time: this.time(),
        cuisines: this.cuisines(),
        starIngredient: this.starIngredient(),
        preferRealRecipes: this.preferRealRecipes(),
      };

      await this.engine.generateAndSave(params);
      this.generatedOnce.set(true);

      setTimeout(
        () =>
          document
            .getElementById('results')
            ?.scrollIntoView({ behavior: 'smooth' }),
        50,
      );
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to generate ideas.');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  private cleanCuisine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
