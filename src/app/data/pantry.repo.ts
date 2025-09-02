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
import { Observable, of } from 'rxjs';
import { PantryItem } from '../models/pantry-item.model';

@Injectable({ providedIn: 'root' })
export class PantryRepo {
  private fs = inject(Firestore);

  /** Stream all pantry items (alpha by name) */
  list$(): Observable<PantryItem[]> {
    const ref = collection(this.fs, 'pantryItems');
    const q = query(ref, orderBy('name'));
    return collectionData(q, { idField: 'id' }) as Observable<PantryItem[]>;
  }

  /** Optional filtered stream (by tag) */
  listByTag$(tag: string): Observable<PantryItem[]> {
    const ref = collection(this.fs, 'pantryItems');
    const q = query(ref, where('tags', 'array-contains', tag), orderBy('name'));
    return collectionData(q, { idField: 'id' }) as Observable<PantryItem[]>;
  }

  get$(itemId: string): Observable<PantryItem | undefined> {
    const d = doc(this.fs, `pantryItems/${itemId}`);
    return docData(d, { idField: 'id' }) as Observable<PantryItem | undefined>;
  }

  async add(data: Omit<PantryItem, 'id' | 'updatedAt'>): Promise<string> {
    const ref = collection(this.fs, 'pantryItems');
    const res = await addDoc(ref, { ...data, updatedAt: serverTimestamp() as unknown as Timestamp });
    return res.id;
  }

  async upsert(itemId: string, data: Partial<PantryItem>): Promise<void> {
    const d = doc(this.fs, `pantryItems/${itemId}`);
    await setDoc(d, { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async update(itemId: string, patch: Partial<PantryItem>): Promise<void> {
    const d = doc(this.fs, `pantryItems/${itemId}`);
    await updateDoc(d, { ...patch, updatedAt: serverTimestamp() });
  }

  async remove(itemId: string): Promise<void> {
    const d = doc(this.fs, `pantryItems/${itemId}`);
    await deleteDoc(d);
  }

  /** Bulk remove (e.g., clear expired) */
  async removeMany(itemIds: string[]): Promise<void> {
    if (!itemIds?.length) return;
    const batch = writeBatch(this.fs);
    for (const id of itemIds) batch.delete(doc(this.fs, `pantryItems/${id}`));
    await batch.commit();
  }

  /** Keep only latest N items by updatedAt (utility; optional) */
  async keepLatest(n: number): Promise<void> {
    const ref = collection(this.fs, 'pantryItems');
    const q = query(ref, orderBy('updatedAt', 'desc'), limit(200));
    const snap = await getDocs(q as any);
    const toDelete = snap.docs.slice(n);
    if (!toDelete.length) return;
    const batch = writeBatch(this.fs);
    toDelete.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
