import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collectionData,
  docData,
  query,
  orderBy,
  where,
  limit,
  writeBatch
} from '@angular/fire/firestore';
import { Timestamp, serverTimestamp, getDocs } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Idea } from '../models/idea.model';
import { IdeaIngredient } from '../models/idea-ingredient.model';

type ReadinessTier = 'READY' | 'N1' | 'N2';

@Injectable({ providedIn: 'root' })
export class IdeasRepo {
  private fs = inject(Firestore);

  /** Stream ideas (optionally by readiness tier), sorted by score then createdAt */
  list$(opts?: { tier?: ReadinessTier; limit?: number }): Observable<Idea[]> {
    const ref = collection(this.fs, 'ideas');
    const clauses: any[] = [];
    if (opts?.tier) clauses.push(where('readinessTier', '==', opts.tier));
    clauses.push(orderBy('totalScore', 'desc'), orderBy('createdAt', 'desc'));
    if (opts?.limit) clauses.push(limit(opts.limit));
    const q = query(ref, ...clauses);
    return collectionData(q, { idField: 'id' }) as Observable<Idea[]>;
  }

  get$(ideaId: string): Observable<Idea | undefined> {
    const d = doc(this.fs, `ideas/${ideaId}`);
    return docData(d, { idField: 'id' }) as Observable<Idea | undefined>;
  }

  ingredients$(ideaId: string): Observable<IdeaIngredient[]> {
    const ref = collection(this.fs, `ideas/${ideaId}/ingredients`);
    const q = query(ref, orderBy('name'));
    return collectionData(q, { idField: 'id' }) as Observable<IdeaIngredient[]>;
  }

  /**
   * Upsert idea + write/replace ingredients in a single batch.
   * Pass `ideaId = null` to create a new idea document.
   * If you want to fully replace ingredients, pass the full current list you want to keep.
   * (To hard-replace, first read old ingredient IDs and batch.delete them, then write new set.)
   */
  async upsertIdeaWithIngredients(
    ideaId: string | null,
    idea: Omit<Idea, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Idea, 'createdAt' | 'updatedAt'>>,
    ingredients: IdeaIngredient[]
  ): Promise<string> {
    const now = serverTimestamp() as unknown as Timestamp;

    const ideaRef = ideaId
      ? doc(this.fs, `ideas/${ideaId}`)
      : doc(collection(this.fs, 'ideas'));

    const missing = Math.max(0, Math.floor(idea.missingCount ?? 0));
    const tier: ReadinessTier = missing === 0 ? 'READY' : missing === 1 ? 'N1' : 'N2';

    const batch = writeBatch(this.fs);

    // Upsert idea
    batch.set(
      ideaRef,
      {
        ...idea,
        readinessTier: tier,
        missingCount: Math.min(missing, 2),
        createdAt: (idea as any).createdAt ?? now,
        updatedAt: now
      },
      { merge: true }
    );

    // (Optional) If you want a true replace, first fetch and delete existing ingredients here.
    const ingColPath = `${ideaRef.path}/ingredients`;
    for (const ing of ingredients) {
      const ingRef = ing.id
        ? doc(this.fs, `${ingColPath}/${ing.id}`)
        : doc(collection(this.fs, ingColPath));
      batch.set(ingRef, ing, { merge: true });
    }

    await batch.commit();
    return ideaRef.id;
  }

  async deleteIdea(ideaId: string, { deleteIngredients = false } = {}): Promise<void> {
    const ideaRef = doc(this.fs, `ideas/${ideaId}`);
    if (deleteIngredients) {
      // Delete subcollection docs (simple paged delete)
      const ingRef = collection(this.fs, `ideas/${ideaId}/ingredients`);
      const snap = await getDocs(query(ingRef, limit(300)) as any);
      if (!snap.empty) {
        const batch = writeBatch(this.fs);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(ideaRef);
  }

  /** Keep only latest N ideas by createdAt (utility; optional) */
  async keepLatest(n: number): Promise<void> {
    const ref = collection(this.fs, 'ideas');
    const q = query(ref, orderBy('createdAt', 'desc'), limit(200));
    const snap = await getDocs(q as any);
    const toDelete = snap.docs.slice(n);
    if (!toDelete.length) return;
    const batch = writeBatch(this.fs);
    toDelete.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
