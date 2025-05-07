// src/app/core/supabase.client.ts
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

console.log('Creating Supabase client');

// Check if we're in browser environment where localStorage is available
const isBrowser = typeof window !== 'undefined';

// Create a custom storage implementation with error handling
const customStorage = isBrowser
  ? {
      getItem: (key: string): string | null => {
        try {
          return localStorage.getItem(key);
        } catch (error) {
          console.error('Error accessing localStorage:', error);
          return null;
        }
      },
      setItem: (key: string, value: string): void => {
        try {
          localStorage.setItem(key, value);
        } catch (error) {
          console.error('Error writing to localStorage:', error);
        }
      },
      removeItem: (key: string): void => {
        try {
          localStorage.removeItem(key);
        } catch (error) {
          console.error('Error removing from localStorage:', error);
        }
      },
    }
  : undefined;

// Ensure we have valid URL and key
if (!environment.supabaseUrl || !environment.supabaseAnonKey) {
  console.error('Missing Supabase configuration. Please check environment variables.');
}

export const supabase = createClient(
  environment.supabaseUrl || '', // Default to empty string if undefined
  environment.supabaseAnonKey || '', // Default to empty string if undefined
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: customStorage,
      storageKey: 'supabase.auth.token',
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    realtime: {
      timeout: 30000, // shorter timeout to detect connection issues faster
      params: {
        eventsPerSecond: 10,
      },
      headers: {
        // Add application identifier
        'X-Client-Info': 'angchat@1.0.0',
      },
    },
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        'X-Client-Info': 'angchat@1.0.0',
      },
    },
  }
);

// Add debug helper to inspect session
if (isBrowser) {
  (window as any).checkSupabaseSession = async () => {
    const { data } = await supabase.auth.getSession();
    console.log('Current session:', data.session);
    return data.session;
  };
}

// Log for debugging
if (isBrowser) {
  console.log('Realtime client initialized in browser environment');
} else {
  console.log('Realtime client initialized in server environment');
}

// Verify Supabase connection on startup - but only in browser
if (isBrowser) {
  (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      console.log('Session on init:', sessionData.session ? 'Found' : 'Not found');

      const { data, error } = await supabase.from('messages').select('id').limit(1);
      if (error) {
        console.error('Supabase connection test failed:', error.message);
      } else {
        console.log('Supabase connection test successful');
      }
    } catch (e: any) {
      console.error('Supabase initialization error:', e?.message || e);
    }
  })();
}
