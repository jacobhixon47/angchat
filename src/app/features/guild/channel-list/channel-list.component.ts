import { Component, inject, PLATFORM_ID, Inject, effect } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { GuildService, Channel } from '../guild.service';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { CachedImgComponent } from '../../shared/cached-img/cached-img.component';
import { ImageCropperModalComponent } from '../../shared/image-cropper-modal.component';
import { ImageCacheService } from '../../shared/image-cache.service';

@Component({
  selector: 'channel-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CachedImgComponent, ImageCropperModalComponent],
  templateUrl: './channel-list.component.html',
  styleUrls: ['./channel-list.component.scss'],
})
export class ChannelListComponent {
  private guildService = inject(GuildService);
  private auth = inject(AuthService);
  private imageCache = inject(ImageCacheService);
  private isBrowser: boolean;
  isRefreshing = false;
  isLoadingChannels = true;
  private lastRefreshTime = 0;
  private refreshTimeoutId: any = null;

  showCreateChannelModal = false;
  showCreateGuildModal = false;
  showGuildSettingsModal = false;
  newChannelName = '';
  newChannelDescription = '';
  newGuildName = '';
  newGuildDescription = '';
  guildImageFile: File | null = null;
  guildImagePreview: string | null = null;
  uploading = false;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Add an effect to refresh channels when active guild changes
    if (this.isBrowser) {
      effect(() => {
        const activeGuild = this.guildService.activeGuild();
        if (activeGuild) {
          console.log('Guild changed in ChannelListComponent, checking channels');
          this.isLoadingChannels = true;
          this.debouncedRefreshChannels();
        }
      });
    }
  }

  get channels() {
    // Safely return channels with SSR protection
    return () => {
      if (!this.isBrowser) return [];
      const channelsList = this.guildService.channels();

      // Only trigger a refresh if:
      // 1. We're not already refreshing
      // 2. We have an active guild
      // 3. The channel list is empty
      // 4. Enough time has passed since the last refresh
      if (
        !this.isRefreshing &&
        this.activeGuild() &&
        channelsList.length === 0 &&
        Date.now() - this.lastRefreshTime > 5000
      ) {
        console.log('No channels found but guild exists, scheduling refresh...');
        this.debouncedRefreshChannels();
      }

      return channelsList;
    };
  }

  // Method to debounce refreshes
  private debouncedRefreshChannels() {
    if (this.refreshTimeoutId) {
      clearTimeout(this.refreshTimeoutId);
    }

    this.refreshTimeoutId = setTimeout(() => {
      this.refreshChannels();
    }, 500); // Wait 500ms before refreshing
  }

  // Method to manually refresh channels if needed
  refreshChannels() {
    if (!this.isBrowser || this.isRefreshing) return;

    const activeGuild = this.activeGuild();
    if (activeGuild && activeGuild.id) {
      console.log('Refreshing channels for guild:', activeGuild.id);

      // Set refreshing flag and timestamp
      this.isRefreshing = true;
      this.lastRefreshTime = Date.now();

      // If we're the owner and there are no channels, try to create the default channel
      if (this.isGuildOwner() && this.channels().length === 0) {
        console.log('Owner is refreshing with no channels, creating default channel');
        this.createDefaultChannel(activeGuild.id);
        return;
      }

      // Otherwise just load the channels
      this.guildService
        .loadChannels(activeGuild.id)
        .then(() => {
          // Add a small delay before allowing more refreshes
          setTimeout(() => {
            this.isRefreshing = false;
            this.isLoadingChannels = false;
          }, 2000);
        })
        .catch(() => {
          this.isRefreshing = false;
          this.isLoadingChannels = false;
        });
    }
  }

  // Create a default general channel
  async createDefaultChannel(guildId: string) {
    try {
      const result = await this.guildService.createChannel(guildId, 'general', 'General discussion');
      console.log('Created default general channel:', result);
      this.isRefreshing = false;
      this.isLoadingChannels = false;
    } catch (error) {
      console.error('Error creating default channel:', error);
      this.isRefreshing = false;
      this.isLoadingChannels = false;
    }
  }

  get activeChannel() {
    // Safely return activeChannel with SSR protection
    return () => {
      if (!this.isBrowser) return null;
      return this.guildService.activeChannel();
    };
  }

  get activeGuild() {
    // Safely return activeGuild with SSR protection
    return () => {
      if (!this.isBrowser) return null;
      return this.guildService.activeGuild();
    };
  }

  selectChannel(channel: Channel) {
    if (!this.isBrowser) return;
    this.guildService.setActiveChannel(channel);
  }

  openCreateChannelModal() {
    if (!this.isBrowser) return;
    this.showCreateChannelModal = true;
    this.newChannelName = '';
    this.newChannelDescription = '';
  }

  closeCreateChannelModal() {
    if (!this.isBrowser) return;
    this.showCreateChannelModal = false;
  }

  openCreateGuildModal() {
    if (!this.isBrowser) return;
    this.showCreateGuildModal = true;
    this.newGuildName = '';
    this.newGuildDescription = '';
    this.guildImageFile = null;
    this.guildImagePreview = null;
  }

  closeCreateGuildModal() {
    if (!this.isBrowser) return;
    this.showCreateGuildModal = false;
    this.guildImageFile = null;
    this.guildImagePreview = null;
  }

  openGuildSettingsModal() {
    if (!this.isBrowser || !this.isGuildOwner()) return;

    const activeGuild = this.activeGuild();
    if (!activeGuild) return;

    this.showGuildSettingsModal = true;
    this.newGuildName = activeGuild.name;
    this.newGuildDescription = activeGuild.description || '';
    this.guildImageFile = null;

    if (activeGuild.image_url) {
      // Use the image cache service instead of local cache
      this.imageCache
        .getImage(activeGuild.image_url)
        .then((cachedUrl) => {
          this.guildImagePreview = cachedUrl;
        })
        .catch(() => {
          // Fall back to original URL if not cached
          this.guildImagePreview = activeGuild.image_url || null;
        });
    } else {
      this.guildImagePreview = null;
    }
  }

  closeGuildSettingsModal() {
    if (!this.isBrowser) return;
    this.showGuildSettingsModal = false;
    this.guildImageFile = null;
    this.guildImagePreview = null;
  }

  async handleGuildImageSelected(event: Event) {
    if (!this.isBrowser) return;

    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }

      // Limit file size (5MB)
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      if (file.size > MAX_SIZE) {
        alert('Image size must be less than 5MB');
        return;
      }

      this.uploading = true;

      try {
        // Auto-crop the image
        const croppedFile = await this.autoCropImage(file);

        // Convert to data URL for preview
        const dataUrl = await this.fileToDataUrl(croppedFile);

        // Set preview and file for upload
        this.guildImagePreview = dataUrl;
        this.guildImageFile = croppedFile;

        // Store in cache if we're editing an existing guild
        const activeGuild = this.activeGuild();
        if (activeGuild && activeGuild.image_url) {
          this.imageCache.storeImage(activeGuild.image_url, dataUrl);
        }
      } catch (error) {
        console.error('Error processing image:', error);
      } finally {
        this.uploading = false;
      }
    }
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

  // Convert file to data URL for preview
  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async updateGuild() {
    if (!this.isBrowser || !this.newGuildName.trim() || !this.isGuildOwner()) return;

    const activeGuild = this.activeGuild();
    if (!activeGuild) return;

    try {
      await this.guildService.updateGuild(
        activeGuild.id,
        this.newGuildName.trim(),
        this.newGuildDescription.trim() || undefined,
        this.guildImageFile || undefined
      );
      this.closeGuildSettingsModal();
    } catch (error) {
      console.error('Error updating guild:', error);
    }
  }

  async deleteGuild() {
    if (!this.isBrowser || !this.isGuildOwner()) return;

    const activeGuild = this.activeGuild();
    if (!activeGuild) return;

    if (confirm(`Are you sure you want to delete the guild "${activeGuild.name}"? This cannot be undone.`)) {
      try {
        await this.guildService.deleteGuild(activeGuild.id);
        this.closeGuildSettingsModal();
      } catch (error) {
        console.error('Error deleting guild:', error);
      }
    }
  }

  isGuildOwner() {
    if (!this.isBrowser) return false;
    const currentUser = this.auth.user();
    const activeGuild = this.activeGuild();

    if (!currentUser || !activeGuild) return false;
    return currentUser.id === activeGuild.owner_id;
  }

  async createGuild() {
    if (!this.isBrowser || !this.newGuildName.trim()) return;

    try {
      await this.guildService.createGuild(
        this.newGuildName.trim(),
        this.newGuildDescription.trim() || undefined,
        this.guildImageFile || undefined
      );
      this.closeCreateGuildModal();
    } catch (error) {
      console.error('Error creating guild:', error);
    }
  }

  async createChannel() {
    if (!this.isBrowser || !this.newChannelName.trim() || !this.activeGuild()) return;

    // Validate channel name - only letters, numbers, and dashes
    const channelNameRegex = /^[a-zA-Z0-9-]+$/;
    if (!channelNameRegex.test(this.newChannelName.trim())) {
      alert('Channel names can only contain letters, numbers, and dashes');
      return;
    }

    try {
      await this.guildService.createChannel(
        this.activeGuild()!.id,
        this.newChannelName.trim(),
        this.newChannelDescription.trim() || undefined
      );
      this.closeCreateChannelModal();
    } catch (error) {
      console.error('Error creating channel:', error);
    }
  }
}
