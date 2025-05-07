import { Component, OnInit, signal, effect, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { CommonModule } from '@angular/common';
import { User } from '../../../core/auth.service';

@Component({
  selector: 'verify-email-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  verificationSuccess = signal<boolean>(false);
  verificationError = signal<string | null>(null);
  loginInProgress = signal<boolean>(false);

  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  constructor() {
    effect(() => {
      // This effect will run whenever auth state changes
      const user = this.auth.user();
      if (user) {
        console.log('User session detected, redirecting to chat...');
        setTimeout(() => {
          this.router.navigate(['/chat']);
        }, 3000);
      }
    });
  }

  ngOnInit() {
    // Email verification happens automatically by Supabase
    this.verificationSuccess.set(true);

    // Get the auth state
    if (this.auth.user()) {
      // User is already authenticated, redirect after 3 seconds
      setTimeout(() => {
        this.router.navigate(['/chat']);
      }, 3000);
    } else {
      // Try to auto-login with pending registration data
      const pendingData = this.auth.pendingRegistration();
      if (pendingData && pendingData.email && pendingData.password) {
        this.loginInProgress.set(true);
        console.log('Attempting auto-login after email verification');

        // Try to auto-login with stored credentials
        this.auth.login(pendingData.email, pendingData.password).then((success) => {
          if (!success) {
            console.log('Auto-login failed after verification');
            this.loginInProgress.set(false);
            this.verificationError.set('Auto-login failed. Please log in manually.');
          }
        });
      } else {
        // Set error after 5 seconds if no auto-login occurs
        setTimeout(() => {
          if (!this.auth.user()) {
            this.verificationError.set('Session not established after verification. Please try logging in.');
          }
        }, 5000);
      }
    }
  }
}
