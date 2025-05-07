import { Component, Input, Output, EventEmitter, TemplateRef, ContentChild, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Pipe, PipeTransform } from '@angular/core';
import { ImageCacheService } from '../image-cache.service';

@Pipe({ name: 'firstLetter', standalone: true })
export class FirstLetterPipe implements PipeTransform {
  transform(value: string): string {
    return value && value.length > 0 ? value[0].toUpperCase() : '?';
  }
}

@Component({
  selector: 'cached-img',
  standalone: true,
  imports: [CommonModule, FirstLetterPipe],
  template: `
    <div class="relative w-full h-full">
      <!-- When we have no source image -->
      <ng-container *ngIf="!src">
        <ng-container *ngTemplateOutlet="fallbackTemplate || defaultFallback"></ng-container>
      </ng-container>

      <!-- When we have a source image -->
      <ng-container *ngIf="src">
        <!-- The actual image -->
        <img
          [src]="cachedSrc || src"
          [alt]="alt || ''"
          [class]="'object-cover w-full h-full ' + (class || '')"
          [style.opacity]="loaded ? 1 : 0"
          (load)="onLoad()"
          (error)="onError()"
        />

        <!-- Loading state with blank placeholder - no text to avoid flashing -->
        <div *ngIf="!loaded" class="absolute inset-0 bg-gray-700" [class.animate-pulse]="!fastLoading"></div>
      </ng-container>
    </div>

    <!-- Default fallback template -->
    <ng-template #defaultFallback>
      <div class="w-full h-full bg-gray-700 flex items-center justify-center">
        <span class="text-xl text-white font-bold">{{ fallbackText || alt || '?' | firstLetter }}</span>
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
      }
      img {
        transition: opacity 0.3s ease-in-out;
      }
    `,
  ],
})
export class CachedImgComponent {
  private imageCache = inject(ImageCacheService);
  private ngZone = inject(NgZone);

  @Input() src: string | null = null;
  @Input() alt: string = '';
  @Input() class: string = '';
  @Input() fallbackText: string = '';
  @Output() loadedEvent = new EventEmitter<void>();
  @ContentChild(TemplateRef) fallbackTemplate: TemplateRef<any> | null = null;

  loaded = false;
  cachedSrc: string | null = null;
  fastLoading = false; // Track if image is loading from cache (should be fast)

  ngOnChanges() {
    if (this.src) {
      this.loaded = false;
      this.loadFromCache();
    }
  }

  private async loadFromCache() {
    if (!this.src) return;

    try {
      this.fastLoading = false;

      // Check if it's a data URL (already in memory)
      if (this.src.startsWith('data:')) {
        this.cachedSrc = this.src;
        this.fastLoading = true;
        this.checkImageLoaded();
        return;
      }

      // Get the image from cache or network
      const cachedUrl = await this.imageCache.getImage(this.src);
      this.cachedSrc = cachedUrl;

      // If the image is from cache (base64 data URL), it should load instantly
      if (cachedUrl.startsWith('data:')) {
        this.fastLoading = true;
        this.checkImageLoaded();
      }
    } catch (error) {
      console.error(`Error loading image from cache: ${this.src}`, error);
    }
  }

  /**
   * Check if the image is already loaded (for cached images)
   */
  private checkImageLoaded() {
    if (!this.cachedSrc) return;

    // For data URLs, we can try to preload the image
    const img = new Image();
    img.src = this.cachedSrc;

    // If image is already in browser cache, it might load immediately
    if (img.complete) {
      // Use NgZone to ensure Angular detects the change
      this.ngZone.run(() => {
        this.loaded = true;
        this.loadedEvent.emit();
      });
    }
  }

  onLoad() {
    this.loaded = true;
    this.loadedEvent.emit();
  }

  onError() {
    this.loaded = false;
    this.fastLoading = false;
    console.error(`Failed to load image: ${this.src}`);
  }
}
