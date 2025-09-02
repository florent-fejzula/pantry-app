export interface IdeaIngredient {
  id: string;
  name: string;
  canonicalIngredientId?: string;
  requiredQuantity?: number;
  requiredUnit?: string;

  matchedPantryItemId?: string;
  matchedQuantity?: number;
  matchScore?: number;

  isMissing: boolean;

  suggestedSubstitutes?: Array<{
    name: string;
    canonicalIngredientId?: string;
    source: 'local' | 'global' | 'model';
    rationale?: string;
  }>;
}
