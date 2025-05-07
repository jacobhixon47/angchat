import { Component, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from 'src/app/core/auth.service';
import { supabase } from 'src/app/core/supabase.client';
import { ImageCacheService } from 'src/app/features/shared/image-cache.service';
import { CachedImgComponent } from 'src/app/features/shared/cached-img/cached-img.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, CachedImgComponent],
  template: `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" *ngIf="isOpen()">
      <div class="bg-gray-800 p-6 rounded-lg w-96 max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold text-white mb-4 flex justify-between items-center">
          User Profile
          <button (click)="close()" class="text-gray-400 hover:text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </h2>

        <div class="space-y-4">
          <!-- Profile Picture -->
          <div class="flex flex-col items-center mb-4">
            <div class="relative h-24 w-24">
              <!-- Use cached-img component for avatar -->
              <div *ngIf="!uploading" class="h-24 w-24 rounded-full overflow-hidden flex items-center justify-center">
                <cached-img
                  [src]="avatarUrl()"
                  [alt]="user()?.username || ''"
                  [fallbackText]="user()?.username || ''"
                  class="w-full h-full"
                >
                  <ng-template>
                    <div class="h-full w-full bg-purple-600 flex items-center justify-center">
                      <span class="text-2xl text-white font-bold">{{
                        (user()?.username || '?')[0]?.toUpperCase()
                      }}</span>
                    </div>
                  </ng-template>
                </cached-img>
              </div>

              <div *ngIf="uploading" class="h-24 w-24 rounded-full bg-gray-700 flex items-center justify-center">
                <svg
                  class="animate-spin h-8 w-8 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </div>
              <button
                (click)="fileInput.click()"
                class="absolute bottom-0 right-0 bg-purple-600 rounded-full p-2 text-white shadow-lg hover:bg-purple-500"
                [disabled]="uploading"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
              <input #fileInput type="file" (change)="uploadAvatar($event)" accept="image/*" class="hidden" />
            </div>
            <p *ngIf="avatarError" class="text-red-500 text-sm mt-2">{{ avatarError }}</p>
          </div>

          <!-- Username -->
          <div>
            <label for="username" class="block text-sm font-medium text-gray-300 mb-1">Username</label>
            <input
              type="text"
              id="username"
              [(ngModel)]="username"
              class="w-full border border-gray-600 rounded px-3 py-2 bg-gray-700 text-white"
              placeholder="Username"
            />
          </div>

          <div *ngIf="error()" class="text-red-500 text-sm">{{ error() }}</div>

          <div class="flex justify-between mt-6">
            <button (click)="close()" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500">Cancel</button>
            <button
              (click)="updateProfile()"
              class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500"
              [disabled]="updating"
            >
              {{ updating ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>

          <!-- Logout Button -->
          <div class="mt-6 pt-6 border-t border-gray-700">
            <button
              (click)="logout()"
              class="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center justify-center gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ProfileComponent {
  @Output() profileUpdated = new EventEmitter<void>();

  private auth = inject(AuthService);
  private imageCache = inject(ImageCacheService);
  isOpen = signal<boolean>(false);
  user = this.auth.user;
  error = signal<string | null>(null);

  username = '';
  avatarUrl = signal<string | null>(null);
  avatarError: string | null = null;
  uploading = false;
  updating = false;

  constructor() {}

  async open() {
    try {
      // Refresh user data from the server before opening the modal
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        // Fetch latest profile data
        const { data: profileData } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', sessionData.session.user.id)
          .single();

        if (profileData) {
          // Update auth service with latest user data
          this.auth.user.update((user) => (user ? { ...user, username: profileData.username } : null));
        }
      }

      // Now set the username from the refreshed user state
      this.username = this.user()?.username || '';
      this.isOpen.set(true);
      this.fetchAvatar();
    } catch (error) {
      console.error('Error refreshing user data:', error);
      // Still open the modal with existing data if refresh fails
      this.username = this.user()?.username || '';
      this.isOpen.set(true);
      this.fetchAvatar();
    }
  }

  close() {
    this.isOpen.set(false);
    this.error.set(null);
    this.avatarError = null;
    this.profileUpdated.emit();
  }

  async fetchAvatar() {
    const userId = this.user()?.id;
    if (!userId) return;

    try {
      const { data, error } = await supabase.from('profiles').select('avatar_url').eq('id', userId).single();

      if (error) throw error;

      if (data?.avatar_url) {
        const { data: signedUrl } = await supabase.storage.from('avatars').createSignedUrl(data.avatar_url, 3600);

        if (signedUrl) {
          // Cache the avatar and set avatar URL
          this.imageCache.prefetchImage(signedUrl.signedUrl);
          this.avatarUrl.set(signedUrl.signedUrl);
        }
      }
    } catch (error) {
      console.error('Error fetching avatar:', error);
    }
  }

  async uploadAvatar(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size and type
    if (file.size > 2 * 1024 * 1024) {
      this.avatarError = 'Image must be less than 2MB';
      return;
    }

    if (!file.type.match(/image\/(jpeg|png|gif|webp)/)) {
      this.avatarError = 'File must be an image (JPG, PNG, GIF, WEBP)';
      return;
    }

    this.avatarError = null;
    this.uploading = true;

    try {
      // First auto-crop the image
      const croppedFile = await this.autoCropImage(file);

      const userId = this.user()?.id;
      if (!userId) throw new Error('User not logged in');

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;

      // Convert file to data URL for caching before upload
      const dataUrl = await this.fileToDataUrl(croppedFile);

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, croppedFile);

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: signedUrl } = await supabase.storage.from('avatars').createSignedUrl(fileName, 3600);

      if (!signedUrl) throw new Error('Failed to get file URL');

      // Cache the avatar URL
      this.imageCache.storeImage(signedUrl.signedUrl, dataUrl);

      // Set the avatar URL in component state
      this.avatarUrl.set(signedUrl.signedUrl);

      // Update profile record with new avatar URL
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: fileName }).eq('id', userId);

      if (updateError) throw updateError;

      this.profileUpdated.emit();
    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      this.avatarError = error.message || 'Failed to upload image';
    } finally {
      this.uploading = false;
    }
  }

  // Convert file to data URL for caching
  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Auto-crop the image to a square from the center
  private autoCropImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Determine the size of the square (min of width/height)
          const size = Math.min(img.width, img.height);

          // Calculate the coordinates to crop from center
          const x = (img.width - size) / 2;
          const y = (img.height - size) / 2;

          // Create a canvas to draw the cropped image
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;

          // Draw the image with the crop region
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }

          ctx.drawImage(img, x, y, size, size, 0, 0, size, size);

          // Convert the canvas back to a file
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to create image blob'));
              return;
            }

            const croppedFile = new File([blob], file.name, {
              type: 'image/png',
              lastModified: Date.now(),
            });

            resolve(croppedFile);
          }, 'image/png');
        };

        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };

        img.src = event.target?.result as string;
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }

  async updateProfile() {
    if (!this.username.trim()) {
      this.error.set('Username cannot be empty');
      return;
    }

    this.updating = true;
    this.error.set(null);

    try {
      const userId = this.user()?.id;
      if (!userId) throw new Error('User not logged in');

      // Check if username already exists (if changed)
      if (this.username !== this.user()?.username) {
        const { data: existingUser } = await supabase
          .from('profiles')
          .select('username')
          .eq('username', this.username)
          .neq('id', userId)
          .single();

        if (existingUser) {
          this.error.set('Username is already taken');
          return;
        }
      }

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          username: this.username,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Update local user state
      if (this.user()) {
        this.auth.user.set({
          ...this.user()!,
          username: this.username,
        });
      }

      this.profileUpdated.emit();
      this.close();
    } catch (error: any) {
      console.error('Error updating profile:', error);
      this.error.set(error.message || 'Failed to update profile');
    } finally {
      this.updating = false;
    }
  }

  async logout() {
    try {
      await this.auth.logout();
      this.close();
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }
}
