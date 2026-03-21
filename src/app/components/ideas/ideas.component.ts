import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';

import { PantryRepo } from '../../data/pantry.repo';
import { IdeasRepo } from '../../data/ideas.repo';
import { IdeaEngineService, GenerateParams } from '../../data/idea-engine.service';

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

  /** Free-text prompt */
  prompt = new FormControl<string>('', { nonNullable: true });

  /** Filters */
  maxMissing = signal<0 | 1 | 2>(1);
  time = signal<number | null>(null);   // null = no preference
  cuisines = signal<string[]>([]);      // start empty

  /** Star ingredient */
  starInput = new FormControl<string>('', { nonNullable: true });
  starIngredient = signal<string | null>(null);

  /** UI state */
  loading = signal(false);
  error = signal<string | null>(null);
  generatedOnce = signal(false);

  /** Pantry names for suggestions (datalist) */
  pantryNames$ = this.pantry.list$().pipe(
    map(items => items.map(i => (i.name || '').trim()).filter(Boolean).sort()),
    startWith([] as string[])
  );

  /** Ideas stream (live) — passed to <app-results> */
  ideas$ = this.repo.list$();

  // -- actions --
  toggleCuisine(c: string) {
    const set = new Set(this.cuisines());
    set.has(c) ? set.delete(c) : set.add(c);
    this.cuisines.set(Array.from(set));
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
      const params: GenerateParams = {
        prompt: this.prompt.value.trim(),
        maxMissing: this.maxMissing(),
        time: this.time(),
        cuisines: this.cuisines(),
        starIngredient: this.starIngredient()
      };
      await this.engine.generateAndSave(params);
      this.generatedOnce.set(true);
      // smooth scroll to results
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Failed to generate ideas.');
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }
}
