import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { supabase } from './supabase.client';

export const authGuard: CanActivateFn = async (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  console.log('Auth guard checking authentication');

  // First check if we have a user in the auth service state
  if (auth.user()) {
    console.log('User found in auth service state, allowing access');
    return true;
  }

  // If not, double-check with Supabase directly
  console.log('No user in auth service, checking Supabase session');
  const { data } = await supabase.auth.getSession();

  if (data.session?.user) {
    console.log('Valid session found in Supabase, updating auth service');
    // Update our auth service with the user from the session
    auth.user.set(data.session.user);

    // Try to get the username
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', data.session.user.id)
        .single();

      if (profileData) {
        auth.user.update((user) => (user ? { ...user, username: profileData.username } : null));
      }
    } catch (err) {
      console.error('Error fetching profile in guard:', err);
      // Continue anyway with basic user data
    }

    return true;
  }

  console.log('No authenticated user found, redirecting to login');
  router.navigate(['/login']);
  return false;
};
