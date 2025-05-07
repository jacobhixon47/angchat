import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { AppComponent } from './app/app.component';
import { LoginComponent } from './app/features/auth/login/login.component';
import { RegisterComponent } from './app/features/auth/register/register.component';
import { VerifyEmailComponent } from './app/features/auth/verify-email/verify-email.component';
import { ChatComponent } from './app/features/chat/chat/chat.component'; // you'll build this next
import { authGuard } from './app/core/auth.guard';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    FormsModule,
    ReactiveFormsModule,
    provideRouter([
      { path: '', redirectTo: 'chat', pathMatch: 'full' },
      { path: 'login', component: LoginComponent },
      { path: 'register', component: RegisterComponent },
      { path: 'verify-email', component: VerifyEmailComponent },
      {
        path: 'chat',
        component: ChatComponent,
        canActivate: [authGuard],
      },
      { path: '**', redirectTo: 'chat' },
    ]),
  ],
}).catch((err) => console.error(err));
