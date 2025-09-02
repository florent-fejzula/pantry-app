import { Injectable, inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { map, shareReplay } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AuthUserService {
  private auth = inject(Auth);
  // Emits the current UID or null; cache latest
  uid$ = authState(this.auth).pipe(
    map(u => u?.uid ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
