import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { PantryRepo } from '../../data/pantry.repo';
import { map, startWith } from 'rxjs';

@Component({
  selector: 'app-ideas',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './ideas.component.html',
  styleUrls: ['./ideas.component.scss'],
})
export class IdeasComponent {
  private pantry = inject(PantryRepo);

  /** Free-text prompt */
  prompt = new FormControl<string>('', { nonNullable: true });

  /** Filters */
  maxMissing = signal<0 | 1 | 2>(1);
  time = signal<number | null>(null);         // null = no preference
  cuisines = signal<string[]>([]);            // start empty

  /** Star ingredient */
  starInput = new FormControl<string>('', { nonNullable: true });
  starIngredient = signal<string | null>(null);

  /** Pantry names for suggestions */
  pantryNames$ = this.pantry.list$().pipe(
    map(items => items.map(i => (i.name || '').trim()).filter(Boolean).sort()),
    startWith([] as string[])
  );

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
}
