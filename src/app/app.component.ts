import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  constructor(private auth: AuthService, private router: Router) {}

  async ngOnInit() {
    console.log('App initializing...');

    try {
      // Initialize auth and handle existing session
      await this.auth.init();
      console.log('Auth initialized, current user:', this.auth.user() ? 'Found' : 'Not found');

      // Don't force navigation - let the routing guards handle it
      // The auth service will already navigate to login if needed

      // Add a helper for debugging
      if (typeof window !== 'undefined') {
        (window as any).debugAuth = {
          getUser: () => this.auth.user(),
          checkSession: async () => {
            const { data } = await (window as any).checkSupabaseSession();
            return data;
          },
          navigate: (path: string) => this.router.navigate([path]),
        };
      }
    } catch (error) {
      console.error('Error during app initialization:', error);
      // Only navigate to login if there's a critical error
      this.router.navigate(['/login']);
    }
  }
}
