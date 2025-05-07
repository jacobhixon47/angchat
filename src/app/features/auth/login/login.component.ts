import { Component, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  form;
  error;
  verificationSuccess = signal<boolean>(false);
  autoLoginInProgress = signal<boolean>(false);

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });
    this.error = this.auth.error;
  }

  ngOnInit() {
    // Check if user came from email verification
    this.route.queryParams.subscribe((params) => {
      if (params['verified'] === 'true') {
        this.verificationSuccess.set(true);
        this.autoLoginInProgress.set(true);

        // Auto-hide the message after 5 seconds
        setTimeout(() => {
          this.verificationSuccess.set(false);
        }, 5000);

        // If user has an active session, redirect to chat
        if (this.auth.user()) {
          this.router.navigate(['/chat']);
        } else {
          // Check for session from Supabase directly
          const pendingData = this.auth.pendingRegistration();
          if (pendingData && pendingData.email && pendingData.password) {
            // Try to auto-login with stored credentials
            this.auth.login(pendingData.email, pendingData.password).then((success) => {
              if (success) {
                this.router.navigate(['/chat']);
              } else {
                this.autoLoginInProgress.set(false);
              }
            });
          } else {
            this.autoLoginInProgress.set(false);
          }
        }
      }
    });
  }

  async submit() {
    if (this.form.invalid) {
      return;
    }

    await this.auth.login(this.form.value.email!, this.form.value.password!);

    if (!this.auth.error()) {
      this.router.navigate(['/chat']);
    }
  }
}
