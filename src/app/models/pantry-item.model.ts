// e.g. src/app/models/pantry-item.ts
import type { Timestamp, FieldValue } from 'firebase/firestore';

export interface PantryItem {
  id: string;
  name: string;
  canonicalIngredientId?: string;
  quantity?: number;
  unit?: string;
  bestBeforeDate?: string;
  acquiredAt?: Timestamp;                 // was firebase.default.firestore.Timestamp
  updatedAt: Timestamp | FieldValue;      // allow serverTimestamp() when writing
  tags?: string[];
  notes?: string;
  freshnessScore?: number;
  storage?: 'fridge' | 'freezer' | 'pantry' | 'other';
  substitutes?: string[];
}
