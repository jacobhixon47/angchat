import { Component, inject, OnInit, OnDestroy, signal, effect, DestroyRef, EffectRef } from '@angular/core';
import { ChatService, Message } from '../chat.service';
import { CommonModule } from '@angular/common';
import { AuthService } from 'src/app/core/auth.service';
import { supabase } from 'src/app/core/supabase.client';
import { GuildService } from 'src/app/features/guild/guild.service';
import { CachedImgComponent } from '../../shared/cached-img/cached-img.component';
import { ImageCacheService } from '../../shared/image-cache.service';

interface UserProfile {
  username: string;
  avatar_url?: string | null;
}

@Component({
  selector: 'chat-list',
  standalone: true,
  imports: [CommonModule, CachedImgComponent],
  templateUrl: './chat-list.component.html',
})
export class ChatListComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private chat = inject(ChatService);
  private guildService = inject(GuildService);
  private imageCache = inject(ImageCacheService);
  private destroyRef = inject(DestroyRef);
  private userProfiles = signal<Record<string, UserProfile>>({});
  private messageEffectCleanup: EffectRef | null = null;
  isLoading = signal<boolean>(true);
  private profilesLoaded = signal<boolean>(false);
  private cachedProfilesByChannel: Record<string, Record<string, UserProfile>> = {};

  // Use the chat service's messages signal directly
  get messages() {
    return this.chat.messages;
  }

  constructor() {
    console.log('ChatListComponent initialized');

    try {
      // Set up an effect to watch for active channel changes to set loading state
      effect(() => {
        const activeChannel = this.guildService.activeChannel();
        if (activeChannel) {
          this.isLoading.set(true);
          this.profilesLoaded.set(false);

          // Check if we have cached profiles for this channel
          if (this.cachedProfilesByChannel[activeChannel.id]) {
            console.log(`Using cached profiles for channel ${activeChannel.id}`);
            this.userProfiles.set(this.cachedProfilesByChannel[activeChannel.id]);
            this.profilesLoaded.set(true);
          }
        }
      });

      // Set up an effect to watch for message changes, with better error handling
      const messageEffect = effect(() => {
        try {
          // Access messages() to register the dependency
          const messages = this.messages();
          // Set loading to false when messages are loaded
          this.isLoading.set(false);

          if (messages.length > 0) {
            // When messages change, load profiles
            this.loadUserProfiles();
          }
        } catch (error) {
          console.error('Error in messages effect:', error);
          this.isLoading.set(false);
        }
      });

      // Store the cleanup function to be called on destroy
      this.messageEffectCleanup = messageEffect;

      // Register cleanup with Angular's DestroyRef
      this.destroyRef.onDestroy(() => {
        if (this.messageEffectCleanup) {
          this.messageEffectCleanup.destroy();
          this.messageEffectCleanup = null;
        }
      });
    } catch (error) {
      console.error('Error setting up effect in ChatListComponent:', error);
      this.isLoading.set(false);
    }
  }

  async ngOnInit() {
    console.log('ChatListComponent ngOnInit');
    try {
      await this.loadUserProfiles();
    } catch (error) {
      console.error('Error loading profiles in ngOnInit:', error);
    }
  }

  ngOnDestroy() {
    console.log('ChatListComponent destroyed');
    // Effect cleanup is handled by DestroyRef
  }

  isOwn(m: Message) {
    try {
      return m.user_id === this.auth.user()?.id;
    } catch (error) {
      console.error('Error in isOwn:', error);
      return false;
    }
  }

  async loadUserProfiles() {
    try {
      // Get unique user IDs from messages
      const userIds = [...new Set(this.messages().map((m) => m.user_id))];

      if (userIds.length === 0) return;

      const activeChannel = this.guildService.activeChannel();
      if (!activeChannel) return;

      // Filter out user IDs that we already have profiles for
      const missingUserIds = userIds.filter((id) => !this.userProfiles()[id]);
      if (missingUserIds.length === 0) {
        // All profiles are already loaded
        return;
      }

      // Fetch profiles for these users
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', missingUserIds);

      if (error) {
        console.error('Error loading user profiles:', error);
        return;
      }

      if (data) {
        // Create a map of user_id -> profile
        const profileMap: Record<string, UserProfile> = { ...this.userProfiles() };

        // Process each profile and prefetch avatar images
        const profilePromises = data.map(async (profile) => {
          let avatar_url = profile.avatar_url;
          if (avatar_url) {
            try {
              // Get a signed URL for the avatar
              const { data: signedUrlData, error: signedUrlError } = await supabase.storage
                .from('avatars')
                .createSignedUrl(avatar_url, 3600);

              if (signedUrlData && signedUrlData.signedUrl) {
                avatar_url = signedUrlData.signedUrl;

                // Prefetch the avatar image to populate the cache
                await this.imageCache.getImage(avatar_url); // Force prefetch and wait
              } else if (signedUrlError) {
                console.error('Error getting signed avatar URL:', signedUrlError);
                avatar_url = null;
              }
            } catch (err) {
              console.error('Error fetching signed avatar URL:', err);
              avatar_url = null;
            }
          }
          return { id: profile.id, profile: { username: profile.username, avatar_url } };
        });

        // Wait for all profile processing to complete
        const processedProfiles = await Promise.all(profilePromises);

        // Build the profile map
        processedProfiles.forEach(({ id, profile }) => {
          profileMap[id] = profile;
        });

        // Update the profiles signal
        this.userProfiles.set(profileMap);

        // Cache profiles for this channel
        if (activeChannel) {
          this.cachedProfilesByChannel[activeChannel.id] = profileMap;
        }
      }
    } catch (error) {
      console.error('Error in loadUserProfiles:', error);
    }
  }

  getUsernameForMessage(message: Message): string {
    try {
      if (!message || !message.user_id) {
        return 'Unknown User';
      }

      const profile = this.userProfiles()[message.user_id];
      // Return username if available, otherwise return "Loading..." instead of user_id
      return profile?.username || 'Loading...';
    } catch (error) {
      console.error('Error in getUsernameForMessage:', error);
      return 'Unknown User';
    }
  }

  getAvatarUrlForMessage(message: Message): string | null {
    try {
      if (!message || !message.user_id) return null;
      const profile = this.userProfiles()[message.user_id];
      return profile?.avatar_url || null;
    } catch (error) {
      console.error('Error in getAvatarUrlForMessage:', error);
      return null;
    }
  }

  isProfileLoaded(userId: string): boolean {
    return !!this.userProfiles()[userId]?.username;
  }
}
