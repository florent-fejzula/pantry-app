import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { combineLatest, map, startWith } from 'rxjs';
import { inject } from '@angular/core';
import { PantryItem } from '../../models/pantry-item.model';
import { PantryRepo } from '../../data/pantry.repo';

const CATEGORIES = [
  'Veggies',
  'Fruits',
  'Meat',
  'Fish',
  'Dairy',
  'Grains & Pasta',
  'Canned & Jars',
  'Spices',
  'Baking',
  'Sauces & Condiments',
  'Snacks',
  'Frozen',
  'Drinks',
  'Other',
] as const;

type Category = typeof CATEGORIES[number];
const DEFAULT_CATEGORY: Category = 'Other';

@Component({
  selector: 'app-pantry-main',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './pantry-main.component.html',
  styleUrls: ['./pantry-main.component.scss'],
})
export class PantryMainComponent {
  // repo FIRST so it's initialized before items$
  private pantry = inject(PantryRepo);

  // expose categories to template
  categories = [...CATEGORIES];

  // UI controls
  search = new FormControl<string>('', { nonNullable: true });
  newName = new FormControl<string>('', { nonNullable: true });
  selectedCategory = signal<Category>(DEFAULT_CATEGORY);

  // Inline edit state
  editingId = signal<string | null>(null);
  editName = new FormControl<string>('', { nonNullable: true });
  editCategory = new FormControl<Category>(DEFAULT_CATEGORY, { nonNullable: true });

  // Data streams
  items$ = this.pantry.list$();

  filteredGrouped$ = combineLatest([
    this.items$,
    this.search.valueChanges.pipe(startWith(this.search.value)),
  ]).pipe(
    map(([items, q]) => {
      const query = (q ?? '').trim().toLowerCase();
      const filtered = !query
        ? items
        : items.filter(i => (i.name ?? '').toLowerCase().includes(query));

      // Group by first tag (category) if present; else "Other"
      const groups = new Map<string, PantryItem[]>();
      for (const it of filtered) {
        const cat = (it.tags?.[0] as string) || DEFAULT_CATEGORY;
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(it);
      }

      // sort groups by our CATEGORIES order, then alpha fallback
      const order = new Map(CATEGORIES.map((c, idx) => [c, idx]));
      const sortedCats = Array.from(groups.keys()).sort((a, b) => {
        const ia = order.has(a as Category) ? (order.get(a as Category) as number) : 999;
        const ib = order.has(b as Category) ? (order.get(b as Category) as number) : 999;
        return ia - ib || a.localeCompare(b);
      });

      return sortedCats.map(cat => ({
        category: cat,
        items: groups.get(cat)!.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
      }));
    })
  );

  // Actions
  async addQuick() {
    const name = this.newName.value.trim();
    if (!name) return;
    await this.pantry.add({
      name,
      tags: [this.selectedCategory()],
    });
    this.newName.setValue('');
  }

  selectCategory(c: Category) {
    this.selectedCategory.set(c);
  }

  startEdit(item: PantryItem) {
    this.editingId.set(item.id);
    this.editName.setValue(item.name ?? '');
    const cat = (item.tags?.[0] as Category) || DEFAULT_CATEGORY;
    this.editCategory.setValue(CATEGORIES.includes(cat) ? cat : DEFAULT_CATEGORY);
  }

  async saveEdit(itemId: string) {
    const name = this.editName.value.trim();
    if (!name) {
      this.cancelEdit();
      return;
    }
    await this.pantry.update(itemId, {
      name,
      tags: [this.editCategory.value],
    });
    this.cancelEdit();
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  async remove(itemId: string) {
    await this.pantry.remove(itemId);
  }

  // For template trackBy
  trackById = (_: number, it: PantryItem) => it.id;
}
