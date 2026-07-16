import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { HttpClientModule } from '@angular/common/http';

import { AuthUserService } from './data/auth-user.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  private authUser = inject(AuthUserService);

  title = 'pantry-app';
  uid$ = this.authUser.uid$;

  signingIn = signal(false);

  async signInWithGoogle() {
    this.signingIn.set(true);
    try {
      await this.authUser.signInWithGoogle();
    } finally {
      this.signingIn.set(false);
    }
  }

  async signOut() {
    await this.authUser.signOut();
  }
}
