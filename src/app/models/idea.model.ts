import type { Timestamp, FieldValue } from 'firebase/firestore';

export interface Idea {
  id: string;
  prompt: string;
  title: string;
  description?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp | FieldValue;

  missingCount: number;
  readinessTier: 'READY' | 'N1' | 'N2';

  totalScore: number;
  scoreBreakdown?: {
    pantryCoverage: number;
    freshnessBoost?: number;
    preferenceFit?: number;
    difficulty?: number;
  };

  servings?: number;
  totalTimeMinutes?: number;
  difficulty?: 'easy' | 'medium' | 'hard';

  allowSubstitutions: boolean;
  thumbnailUrl?: string;
}
