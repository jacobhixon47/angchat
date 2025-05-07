import { Component, signal, effect, inject } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors,
  FormGroup,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  form;
  error;
  isRegistered = signal<boolean>(false);
  registeredEmail = signal<string>('');
  passwordHint = signal<string>('');
  passwordStrength = signal<number>(0);
  passwordsMatch = signal<boolean | null>(null);
  verificationSuccess = signal<boolean>(false);

  private auth = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  constructor() {
    this.form = this.fb.group(
      {
        email: ['', [Validators.required, Validators.email]],
        username: ['', [Validators.required, Validators.minLength(3), Validators.pattern(/^[a-zA-Z0-9_]+$/)]],
        password: ['', [Validators.required, Validators.minLength(8), this.passwordStrengthValidator()]],
        confirmPassword: ['', [Validators.required]],
      },
      {
        validators: this.passwordMatchValidator,
      }
    );

    this.error = this.auth.error;

    // Monitor password changes to update password hint
    this.form.get('password')?.valueChanges.subscribe((val) => {
      this.updatePasswordHint(val);
      this.checkPasswordsMatch();
    });

    // Monitor confirm password changes to update match status
    this.form.get('confirmPassword')?.valueChanges.subscribe(() => {
      this.checkPasswordsMatch();
    });

    // Watch for verification completion
    effect(() => {
      if (this.auth.verificationComplete()) {
        console.log('Verification completed, showing success message...');
        this.verificationSuccess.set(true);

        // After 3 seconds, redirect to chat
        setTimeout(() => {
          console.log('Redirecting to chat after verification...');
          this.router.navigate(['/chat']);
        }, 3000);
      }
    });
  }

  updatePasswordHint(password: string) {
    if (!password) {
      this.passwordHint.set('');
      this.passwordStrength.set(0);
      return;
    }

    const hasLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    let missing = [];
    if (!hasLength) missing.push('8+ characters');
    if (!hasUppercase) missing.push('uppercase letter');
    if (!hasNumber) missing.push('number');
    if (!hasSymbol) missing.push('symbol');

    // Count the requirements met (0-4)
    let requirementsMet = 0;
    if (hasLength) requirementsMet++;
    if (hasUppercase || hasLowercase) requirementsMet++;
    if (hasNumber) requirementsMet++;
    if (hasSymbol) requirementsMet++;

    this.passwordStrength.set(requirementsMet);

    if (missing.length > 0) {
      this.passwordHint.set(`Password needs: ${missing.join(', ')}`);
    } else {
      this.passwordHint.set('Password meets all requirements');
    }
  }

  passwordStrengthValidator() {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;
      if (!value) {
        return { required: true };
      }

      const hasLength = value.length >= 8;
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumber = /[0-9]/.test(value);
      const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value);

      // Check if all requirements are met
      const passwordValid = hasLength && (hasUppercase || hasLowercase) && hasNumber && hasSymbol;

      return passwordValid
        ? null
        : {
            passwordStrength: {
              hasLength,
              hasUppercase,
              hasLowercase,
              hasNumber,
              hasSymbol,
            },
          };
    };
  }

  passwordMatchValidator(group: FormGroup): ValidationErrors | null {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;

    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  async submit() {
    // Mark all fields as touched to trigger validation messages
    Object.keys(this.form.controls).forEach((key) => {
      const control = this.form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    // Check if all requirements are met
    if (this.form.invalid || this.passwordStrength() < 4 || this.passwordsMatch() !== true) {
      return;
    }

    const email = this.form.value.email!;
    const password = this.form.value.password!;
    const username = this.form.value.username!;

    const success = await this.auth.register(email, password, username);

    if (success) {
      // Store email for display in verification message
      this.registeredEmail.set(email);
      // Show verification screen
      this.isRegistered.set(true);
    }
  }

  // Returns a color based on password strength
  getStrengthColor(): string {
    switch (this.passwordStrength()) {
      case 1:
        return '#ef4444'; // red-500
      case 2:
        return '#f97316'; // orange-500
      case 3:
        return '#eab308'; // yellow-500
      case 4:
        return '#22c55e'; // green-500
      default:
        return '#e5e7eb'; // gray-200
    }
  }

  // Check if passwords match and update signal
  checkPasswordsMatch() {
    const password = this.form.get('password')?.value;
    const confirmPassword = this.form.get('confirmPassword')?.value;

    if (!confirmPassword) {
      this.passwordsMatch.set(null); // No match status if confirm password is empty
      return;
    }

    this.passwordsMatch.set(password === confirmPassword);
  }
}
