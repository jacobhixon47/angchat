import { Injectable, signal, effect, PLATFORM_ID, Inject, Optional } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { supabase } from './supabase.client';
import { Router } from '@angular/router';

export interface User {
  id: string;
  email?: string;
  username?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** current user or null */
  user = signal<User | null>(null);
  /** last auth error message */
  error = signal<string | null>(null);
  /** pending email verification status */
  pendingVerification = signal<boolean>(false);
  /** temporary storage for registration data */
  pendingRegistration = signal<{ email: string; password: string; username: string } | null>(null);
  /** indicates if verification was successful */
  verificationComplete = signal<boolean>(false);
  private initializing = signal<boolean>(true);
  private isBrowser: boolean;

  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) platformId: Object,
    @Optional() @Inject('isServer') private isServer: boolean
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Monitor auth state changes, but only in browser
    if (this.isBrowser) {
      effect(() => {
        const currentUser = this.user();
        if (!currentUser && !this.initializing()) {
          // Only redirect if not initializing to prevent redirect on app start
          console.log('User logged out, redirecting to login');
          this.router.navigate(['/login']);
        }
      });
    }
  }

  /** initialize session on app start */
  async init() {
    // Skip auth initialization on server
    if (!this.isBrowser) {
      console.log('Skipping auth initialization on server');
      this.initializing.set(false);
      return;
    }

    this.initializing.set(true);
    try {
      console.log('Initializing auth service...');

      // Check for stored registration data
      this.loadPendingRegistrationData();

      // get existing session
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        console.log('Existing session found:', data.session.user?.id);

        // Set the user immediately to prevent unnecessary redirects
        if (data.session.user) {
          this.user.set(data.session.user);
        }

        // Fetch user profile to get username
        if (data.session.user) {
          try {
            const { data: profileData, error: profileError } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', data.session.user.id)
              .single();

            if (profileData) {
              console.log('Profile found for user:', profileData.username);
              this.user.update((user) => (user ? { ...user, username: profileData.username } : null));
            } else if (profileError) {
              console.error('Error fetching user profile:', profileError);
              // Don't log out the user if profile fetch fails
              // Just keep the basic user info without username
            }
          } catch (err) {
            console.error('Exception fetching user profile:', err);
            // Don't automatically log out - just keep the session
          }
        }
      } else {
        console.log('No existing session found');
        this.user.set(null);
      }

      // subscribe to future changes
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);

        // Handle different auth events
        if (event === 'SIGNED_IN') {
          console.log('User signed in');

          // Check if this is after email verification
          if (this.pendingVerification()) {
            console.log('User signed in after email verification');
            this.pendingVerification.set(false);
            this.verificationComplete.set(true);

            // If we have pending registration data, create the profile now
            const pendingData = this.pendingRegistration();
            if (pendingData && session?.user) {
              await this.createUserProfile(session.user.id, pendingData.username);
              this.pendingRegistration.set(null);
              this.clearPendingRegistrationData();

              // Set user with username included
              this.user.set({
                ...session.user,
                username: pendingData.username,
              });

              // Navigate user to chat
              this.router.navigate(['/chat']);
            }
          } else if (session?.user) {
            // Normal sign-in, set the user immediately
            this.user.set(session.user);

            // Then try to get the profile data
            try {
              const { data: profileData } = await supabase
                .from('profiles')
                .select('username')
                .eq('id', session.user.id)
                .single();

              if (profileData) {
                this.user.update((user) => (user ? { ...user, username: profileData.username } : null));
              }
            } catch (err) {
              console.error('Error fetching profile during sign in:', err);
              // Just keep the basic user without username
            }
          }
        } else if (event === 'SIGNED_OUT') {
          console.log('User signed out');
          this.user.set(null);
        } else if (event === 'USER_UPDATED') {
          console.log('User updated - checking if this is a verification');

          // Check if this happens during pending verification
          if (this.pendingVerification() && session?.user) {
            // Check if email is now confirmed where it previously wasn't
            if (session.user.email_confirmed_at) {
              console.log('Email now confirmed through USER_UPDATED event');

              // Complete verification flow
              this.pendingVerification.set(false);
              this.verificationComplete.set(true);

              const pendingData = this.pendingRegistration();
              if (pendingData) {
                await this.createUserProfile(session.user.id, pendingData.username);
                this.pendingRegistration.set(null);
                this.clearPendingRegistrationData();

                // Set user with username included
                this.user.set({
                  ...session.user,
                  username: pendingData.username,
                });

                // Navigate user to chat
                this.router.navigate(['/chat']);
              }
            }
          }
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed');
          if (session) {
            // Just update the user object with the new session data
            this.user.set(session.user);
          }
        }

        // For any event with a session, ensure we have user data
        if (session?.user && !this.user()) {
          this.user.set(session.user);

          try {
            // Try to get profile data
            const { data: profileData } = await supabase
              .from('profiles')
              .select('username')
              .eq('id', session.user.id)
              .single();

            if (profileData) {
              this.user.update((user) => (user ? { ...user, username: profileData.username } : null));
            }
          } catch (err) {
            console.error('Error fetching profile data:', err);
            // Keep basic user data
          }
        } else if (!session && event !== 'SIGNED_OUT') {
          // If we have no session and it's not because of an explicit sign out,
          // we should not clear the user from state to avoid flash of login screen
          console.log('Auth state change with no session, but not setting user to null');
        }
      });

      // Clean up subscription on service destroy
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
          subscription.unsubscribe();
        });
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
      this.error.set('Failed to initialize authentication');
      this.user.set(null);
    } finally {
      this.initializing.set(false);
    }
  }

  /** sign up with email, password & username */
  async register(email: string, password: string, username: string) {
    try {
      // Check if username is already taken
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username)
        .single();

      if (existingUser) {
        this.error.set('Username is already taken');
        return false;
      }

      // Reset verification status
      this.verificationComplete.set(false);

      // Register the user with email confirmation
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
          emailRedirectTo: `${window.location.origin}/verify-email`,
        },
      });

      if (error) {
        this.error.set(error.message);
        return false;
      }

      // Store pending registration data for later
      const registrationData = { email, password, username };
      this.pendingRegistration.set(registrationData);
      this.storePendingRegistrationData(registrationData);

      // Set verification pending flag
      this.pendingVerification.set(true);

      // Store user without profile info for now
      if (data.user) {
        this.user.set(data.user);
      }

      return true; // Success indicator
    } catch (error: any) {
      console.error('Registration error:', error);
      this.error.set(error.message || 'An error occurred during registration');
      return false;
    }
  }

  /** Create user profile after email verification */
  private async createUserProfile(userId: string, username: string) {
    try {
      // Create the user profile
      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId,
        username,
        display_name: username,
        avatar_url: null,
        updated_at: new Date().toISOString(),
      });

      if (profileError) {
        console.error('Error creating profile:', profileError);
        this.error.set('Failed to create user profile: ' + profileError.message);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error('Profile creation error:', error);
      this.error.set(error.message || 'An error occurred creating your profile');
      return false;
    }
  }

  /** log in with email & password */
  async login(email: string, password: string) {
    try {
      console.log('Logging in with email:', email);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Login error from Supabase:', error.message);
        this.error.set(error.message);
        return false;
      }

      console.log('Login successful, session established');

      // Immediately set the user to prevent flashing login screens
      if (data.user) {
        this.user.set(data.user);
      }

      // Fetch user profile to get username
      if (data.user) {
        try {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', data.user.id)
            .single();

          if (profileData) {
            console.log('Profile found for user:', profileData.username);
            this.user.set({
              ...data.user,
              username: profileData.username,
            });
          } else if (profileError) {
            console.error('Error fetching profile:', profileError);
            // Don't reject the login if profile fetch fails - keep basic user data
          } else {
            console.log('No profile found for user, but keeping session');
            // Check if it's a pending verification
            const pendingData = this.pendingRegistration();
            if (pendingData && pendingData.email === email) {
              // User has verified email but profile wasn't created yet
              await this.createUserProfile(data.user.id, pendingData.username);
              this.user.set({
                ...data.user,
                username: pendingData.username,
              });
              this.pendingRegistration.set(null);
              this.clearPendingRegistrationData();
            }
          }
        } catch (err) {
          console.error('Exception fetching profile:', err);
          // Don't reject the login if profile fetch fails
        }
      }

      return true;
    } catch (error: any) {
      console.error('Login error:', error);
      this.error.set(error.message || 'An error occurred during login');
      return false;
    }
  }

  /** log out */
  async logout() {
    await supabase.auth.signOut();
    this.user.set(null);
    this.pendingVerification.set(false);
    this.clearPendingRegistrationData();
  }

  /** Store registration data in localStorage */
  private storePendingRegistrationData(data: { email: string; password: string; username: string }) {
    if (this.isBrowser) {
      try {
        localStorage.setItem('pendingRegistration', JSON.stringify(data));
      } catch (e) {
        console.error('Failed to store registration data:', e);
      }
    }
  }

  /** Load registration data from localStorage */
  private loadPendingRegistrationData() {
    if (this.isBrowser) {
      try {
        const data = localStorage.getItem('pendingRegistration');
        if (data) {
          const parsedData = JSON.parse(data);
          this.pendingRegistration.set(parsedData);
          console.log('Loaded pending registration data for:', parsedData.email);
        }
      } catch (e) {
        console.error('Failed to load registration data:', e);
      }
    }
  }

  /** Clear registration data from localStorage */
  private clearPendingRegistrationData() {
    if (this.isBrowser) {
      try {
        localStorage.removeItem('pendingRegistration');
      } catch (e) {
        console.error('Failed to clear registration data:', e);
      }
    }
  }
}
