import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, of } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

import { Idea } from '../../models/idea.model';
import { IdeaIngredient } from '../../models/idea-ingredient.model';
import { IdeasRepo } from '../../data/ideas.repo';

type ReadinessTier = 'READY' | 'N1' | 'N2';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent implements OnChanges {
  private ideasRepo = inject(IdeasRepo);

  @Input() ideas: Idea[] = [];
  @Input() generatedOnce = false;

  ingredientStreams: Record<string, Observable<IdeaIngredient[]>> = {};
  private parsedCache = new Map<
    string,
    { ingredients: string[]; steps: string[] }
  >();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ideas']) {
      for (const idea of this.ideas) {
        if (!idea?.id) continue;

        if (!this.ingredientStreams[idea.id]) {
          this.ingredientStreams[idea.id] = this.ideasRepo
            .ingredients$(idea.id)
            .pipe(shareReplay({ bufferSize: 1, refCount: true }));
        }
      }
    }
  }

  trackById = (_: number, it: Idea) => it.id;

  bucket(items: Idea[], tier: ReadinessTier): Idea[] {
    return items.filter((i) => i.readinessTier === tier);
  }

  parsedIngredients(idea: Idea): string[] {
    return this.parseDescription(idea).ingredients;
  }

  parsedSteps(idea: Idea): string[] {
    return this.parseDescription(idea).steps;
  }

  isMissing(
    ingredientName: string,
    linkedIngredients: IdeaIngredient[] | null | undefined,
  ): boolean {
    if (!linkedIngredients?.length) return false;

    const target = this.normalizeName(ingredientName);

    return linkedIngredients.some(
      (ing) => this.normalizeName(ing.name) === target && ing.isMissing,
    );
  }

  private parseDescription(idea: Idea): {
    ingredients: string[];
    steps: string[];
  } {
    const cacheKey = `${idea.id}__${idea.description || ''}`;
    const cached = this.parsedCache.get(cacheKey);
    if (cached) return cached;

    const raw = (idea.description || '').replace(/\r/g, '').trim();

    if (!raw) {
      const empty = { ingredients: [], steps: [] };
      this.parsedCache.set(cacheKey, empty);
      return empty;
    }

    const ingredientsMatch = raw.match(
      /Ingredients:\s*([\s\S]*?)(?:\n\s*Steps:|$)/i,
    );
    const stepsMatch = raw.match(/Steps:\s*([\s\S]*)$/i);

    const ingredientsBlock = ingredientsMatch?.[1]?.trim() || '';
    const stepsBlock = stepsMatch?.[1]?.trim() || '';

    const ingredients = ingredientsBlock
      .split('\n')
      .map((line) => line.replace(/^[•\-]\s*/, '').trim())
      .filter(Boolean);

    const steps = stepsBlock
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);

    const parsed = { ingredients, steps };
    this.parsedCache.set(cacheKey, parsed);
    return parsed;
  }

  private normalizeName(value: string): string {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/[()[\],]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
