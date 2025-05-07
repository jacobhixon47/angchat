import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GuildService, Guild } from '../guild.service';
import { FormsModule } from '@angular/forms';
import { CachedImgComponent } from '../../shared/cached-img/cached-img.component';
import { ImageCacheService } from '../../shared/image-cache.service';

@Component({
  selector: 'guild-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, CachedImgComponent],
  templateUrl: './guild-sidebar.component.html',
  styleUrls: ['./guild-sidebar.component.scss'],
})
export class GuildSidebarComponent {
  private guildService = inject(GuildService);
  private imageCache = inject(ImageCacheService);

  showCreateGuildModal = false;
  newGuildName = '';
  newGuildDescription = '';
  guildImageFile: File | null = null;
  guildImagePreview: string | null = null;
  uploading = false;

  get guilds() {
    return this.guildService.guilds;
  }

  get activeGuild() {
    return this.guildService.activeGuild;
  }

  selectGuild(guild: Guild) {
    this.guildService.setActiveGuild(guild);
  }

  openCreateGuildModal() {
    this.showCreateGuildModal = true;
    this.newGuildName = '';
    this.newGuildDescription = '';
    this.guildImageFile = null;
    this.guildImagePreview = null;
  }

  closeCreateGuildModal() {
    this.showCreateGuildModal = false;
    this.guildImageFile = null;
    this.guildImagePreview = null;
  }

  async handleGuildImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      // Validate file type and size
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }

      // Limit file size (5MB)
      const MAX_SIZE = 5 * 1024 * 1024;
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

  async createGuild() {
    if (!this.newGuildName.trim()) return;

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
}
