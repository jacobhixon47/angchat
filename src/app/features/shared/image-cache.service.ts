import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class ImageCacheService {
  private imageCache: Map<string, string> = new Map();
  private inProgressFetches: Map<string, Promise<string>> = new Map();
  private readonly MAX_CACHE_SIZE = 50; // Maximum number of images to cache in memory
  private readonly CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly CACHE_VERSION = 'v1'; // Cache version for breaking changes
  private accessOrder: string[] = []; // Track access order for LRU eviction
  private isBrowser: boolean;

  constructor() {
    this.isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    // Only initialize from localStorage in browser environment
    if (this.isBrowser) {
      this.initializeFromStorage();
    }
  }

  private initializeFromStorage(): void {
    try {
      const cacheVersion = localStorage.getItem('image-cache-version');
      // If version doesn't match, clear the cache
      if (cacheVersion !== this.CACHE_VERSION) {
        console.log('Cache version mismatch, clearing cache');
        localStorage.removeItem('image-cache');
        localStorage.setItem('image-cache-version', this.CACHE_VERSION);
      } else {
        const savedCache = localStorage.getItem('image-cache');
        if (savedCache) {
          const parsed = JSON.parse(savedCache);

          // Check for expired entries
          const now = Date.now();
          const validEntries = Object.entries(parsed).filter(([url, data]: [string, any]) => {
            return !data.timestamp || now - data.timestamp < this.CACHE_EXPIRY;
          });

          // Extract just the data URLs
          this.imageCache = new Map(validEntries.map(([url, data]: [string, any]) => [url, data.url]));

          // Initialize access order with all keys
          this.accessOrder = Array.from(this.imageCache.keys());

          console.log(`Loaded ${this.imageCache.size} images from cache`);
        }
      }
    } catch (error) {
      console.error('Error loading image cache from localStorage', error);
      // Reset cache on error
      this.imageCache.clear();
      this.accessOrder = [];
    }
  }

  /**
   * Get an image from cache or fetch it
   * @param url The URL of the image to get
   * @param forceRefresh Whether to force a refresh from the network
   * @returns A promise that resolves to the image URL (original or data URL)
   */
  async getImage(url: string, forceRefresh = false): Promise<string> {
    // If the URL is not valid, return the original URL
    if (!url || url === 'null' || url === 'undefined') {
      return url;
    }

    // Update access order (for LRU cache)
    this.updateAccessOrder(url);

    // If we already have this image in cache and no refresh is requested, use it
    if (!forceRefresh && this.imageCache.has(url)) {
      return this.imageCache.get(url)!;
    }

    // If a fetch is already in progress for this URL, return that promise
    if (this.inProgressFetches.has(url)) {
      return this.inProgressFetches.get(url)!;
    }

    // Otherwise, fetch the image and cache it
    const fetchPromise = this.fetchAndCacheImage(url);
    this.inProgressFetches.set(url, fetchPromise);

    try {
      const result = await fetchPromise;
      this.inProgressFetches.delete(url);
      return result;
    } catch (error) {
      this.inProgressFetches.delete(url);
      console.error(`Error fetching image: ${url}`, error);
      return url; // Return the original URL on error
    }
  }

  /**
   * Prefetch and cache an image without waiting for the result
   * @param url The URL of the image to prefetch
   */
  prefetchImage(url: string): void {
    if (!url || url === 'null' || url === 'undefined' || this.imageCache.has(url)) {
      return;
    }

    // Start the fetch but don't wait for it
    this.getImage(url).catch(() => {
      // Ignore errors during prefetching
    });
  }

  /**
   * Store a base64 image directly in the cache
   * @param url The key to store the image under
   * @param base64Data The base64 data to store
   */
  storeImage(url: string, base64Data: string): void {
    if (!url || !base64Data) return;

    this.imageCache.set(url, base64Data);
    this.updateAccessOrder(url);
    this.evictCacheIfNeeded();
    this.saveCache();
  }

  /**
   * Clear the image cache
   */
  clearCache(): void {
    this.imageCache.clear();
    this.accessOrder = [];
    this.saveCache();
  }

  /**
   * Update the access order for LRU cache eviction
   */
  private updateAccessOrder(url: string): void {
    // Remove the URL from its current position
    const index = this.accessOrder.indexOf(url);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }

    // Add the URL to the end (most recently used)
    this.accessOrder.push(url);
  }

  /**
   * Evict least recently used items if cache is too large
   */
  private evictCacheIfNeeded(): void {
    while (this.imageCache.size > this.MAX_CACHE_SIZE && this.accessOrder.length > 0) {
      // Remove the least recently used item (first in the accessOrder array)
      const urlToEvict = this.accessOrder.shift();
      if (urlToEvict) {
        this.imageCache.delete(urlToEvict);
        console.log(`Evicted image from cache: ${urlToEvict}`);
      }
    }
  }

  /**
   * Save the cache to localStorage
   */
  private saveCache(): void {
    if (!this.isBrowser) return;

    try {
      // Create a cache object with timestamps for expiry
      const now = Date.now();
      const cacheObject = Object.fromEntries(
        Array.from(this.imageCache.entries()).map(([url, dataUrl]) => [url, { url: dataUrl, timestamp: now }])
      );

      localStorage.setItem('image-cache', JSON.stringify(cacheObject));
      localStorage.setItem('image-cache-version', this.CACHE_VERSION);
    } catch (error) {
      console.error('Error saving image cache to localStorage', error);
    }
  }

  /**
   * Fetch an image and convert it to a data URL
   * @param url The URL of the image to fetch
   * @returns A promise that resolves to the data URL
   */
  private async fetchAndCacheImage(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        cache: 'no-store', // Always get fresh image
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          this.imageCache.set(url, base64data);
          this.updateAccessOrder(url);
          this.evictCacheIfNeeded();
          this.saveCache();
          resolve(base64data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error(`Error fetching image: ${url}`, error);
      throw error;
    }
  }
}
