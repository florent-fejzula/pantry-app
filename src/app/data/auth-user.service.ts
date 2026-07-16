import { Injectable, inject } from '@angular/core';
import {
  Auth,
  authState,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from '@angular/fire/auth';
import { map, shareReplay } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthUserService {
  private auth = inject(Auth);
  // Emits the current UID or null; cache latest
  uid$ = authState(this.auth).pipe(
    map(u => u?.uid ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Synchronous UID for imperative write paths (only valid once signed in). */
  get currentUid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithPopup(this.auth, new GoogleAuthProvider());
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }
}
