import { Injectable, signal, inject, PLATFORM_ID, Inject, NgZone, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { supabase } from '../../core/supabase.client';
import { AuthService } from '../../core/auth.service';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ImageCacheService } from '../../features/shared/image-cache.service';

export interface Guild {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  image_url?: string;
}

export interface Channel {
  id: string;
  guild_id: string;
  name: string;
  description?: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class GuildService implements OnDestroy {
  private auth = inject(AuthService);
  private ngZone = inject(NgZone);
  private imageCache = inject(ImageCacheService);
  private isBrowser: boolean;

  guilds = signal<Guild[]>([]);
  channels = signal<Channel[]>([]);
  activeGuild = signal<Guild | null>(null);
  activeChannel = signal<Channel | null>(null);

  private guildsSubscription: RealtimeChannel | null = null;
  private channelsSubscription: RealtimeChannel | null = null;

  private _lastLoadedGuildId: string | null = null;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);

    // Only load guilds in browser environment
    if (this.isBrowser) {
      console.log('Guild service initializing in browser');
      this.loadGuilds();
      this.setupGuildsSubscription();
    } else {
      console.log('Guild service running in SSR mode - limited functionality');
    }
  }

  async loadGuilds() {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping loadGuilds in SSR mode');
      return;
    }

    try {
      console.log('Loading guilds from database');
      const { data, error } = await supabase.from('guilds').select('*').order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading guilds:', error);
        this.resetState();
        return;
      }

      if (data && data.length > 0) {
        console.log(`Loaded ${data.length} guilds from database`);

        // Refresh signed URLs for guild images if they exist
        const guildsWithRefreshedImages = await Promise.all(
          data.map(async (guild) => {
            if (guild.image_url && guild.image_url.includes('token=')) {
              // This is a signed URL that might expire, refresh it
              const refreshedUrl = await this.refreshGuildImageUrl(guild.id, guild.image_url);
              if (refreshedUrl) {
                guild.image_url = refreshedUrl;

                // Prefetch the image to cache it
                this.imageCache.prefetchImage(refreshedUrl);
              }
            } else if (guild.image_url) {
              // Prefetch existing images too
              this.imageCache.prefetchImage(guild.image_url);
            }
            return guild;
          })
        );

        this.guilds.set(guildsWithRefreshedImages as Guild[]);

        // If we have guilds but no active guild, set the first one as active
        if (!this.activeGuild()) {
          this.setActiveGuild(guildsWithRefreshedImages[0] as Guild);
        }
      } else {
        console.log('No guilds found in database');
        this.resetState();
      }
    } catch (error) {
      console.error('Error in loadGuilds:', error);
      this.resetState();
    }
  }

  private resetState() {
    if (!this.isBrowser) return;

    console.log('Resetting guild service state');
    this.guilds.set([]);
    this.channels.set([]);
    this.activeGuild.set(null);
    this.activeChannel.set(null);
  }

  async loadChannels(guildId: string) {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping loadChannels in SSR mode');
      return;
    }

    try {
      if (!guildId) {
        console.log('Cannot load channels: No guild ID provided');
        this.channels.set([]);
        this.activeChannel.set(null);
        return;
      }

      // Keep track of the last guild we loaded channels for to prevent duplicate loads
      if (this._lastLoadedGuildId === guildId && this.channels().length > 0) {
        console.log(`Channels for guild ${guildId} already loaded, skipping`);
        return;
      }

      this._lastLoadedGuildId = guildId;

      // First try to get channels from database including the default "general" channel
      console.log(`Loading channels for guild ${guildId} from database`);
      let { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error loading channels:', error);
        this.channels.set([]);
        this.activeChannel.set(null);
        return;
      }

      // If we successfully loaded channels, update state and exit
      if (data && data.length > 0) {
        console.log(`Loaded ${data.length} channels from database`);
        this.channels.set(data as Channel[]);

        // Find the "general" channel or fall back to the first channel
        const generalChannel = data.find((c) => c.name === 'general');
        const firstChannel = data[0];

        // If we have an active channel that's still in the list, keep it
        const currentActiveChannel = this.activeChannel();
        const channelStillExists = currentActiveChannel && data.some((c) => c.id === currentActiveChannel.id);

        if (channelStillExists) {
          // Keep the current channel
          console.log('Keeping current active channel');
        } else if (generalChannel) {
          // Prefer the "general" channel
          console.log('Setting "general" as active channel');
          this.setActiveChannel(generalChannel as Channel);
        } else if (firstChannel) {
          // Fall back to the first channel
          console.log('Setting first channel as active');
          this.setActiveChannel(firstChannel as Channel);
        } else {
          // No channels available
          console.log('No channels available to set as active');
          this.activeChannel.set(null);
        }
        return;
      }

      // Only create a default channel if we're the owner and explicitly requested
      console.log('No channels found for guild, checking if we should create default');

      // Verify the guild exists and that current user is the owner
      const { data: guildData, error: guildError } = await supabase
        .from('guilds')
        .select('*')
        .eq('id', guildId)
        .single();

      if (guildError || !guildData) {
        console.error('Could not verify guild exists:', guildError);
        this.channels.set([]);
        this.activeChannel.set(null);
        return;
      }

      const user = this.auth.user();
      const isOwner = user && guildData.owner_id === user.id;

      // We will not automatically create a default channel here
      // to prevent potential loops. Default channels are created
      // only in createGuild or via manual refresh by the owner
      console.log('Guild exists but has no channels.');

      if (isOwner) {
        console.log('User is owner but no autoCreate was specified');
      }

      this.channels.set([]);
      this.activeChannel.set(null);
    } catch (error) {
      console.error('Error in loadChannels:', error);
      this.channels.set([]);
      this.activeChannel.set(null);
    }
  }

  async createGuild(name: string, description?: string, imageFile?: File) {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping createGuild in SSR mode');
      throw new Error('Cannot create guild in server-side rendering');
    }

    try {
      console.log(`Creating new guild: ${name}`);
      const user = this.auth.user();
      if (!user) throw new Error('Not authenticated');

      // Make sure we have the current auth session token
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('No active session');

      // Create the guild first to get an ID
      const { data, error } = await supabase
        .from('guilds')
        .insert({
          name,
          description,
          owner_id: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating guild:', error);
        throw error;
      }

      console.log('Guild created successfully:', data);
      const guildData = data as Guild;

      // If an image file was provided, upload it and update the guild
      if (imageFile) {
        const imageUrl = await this.uploadGuildImage(guildData.id, imageFile);
        if (imageUrl) {
          // Update the guild with the image URL
          const { data: updatedData, error: updateError } = await supabase
            .from('guilds')
            .update({ image_url: imageUrl })
            .eq('id', guildData.id)
            .select()
            .single();

          if (updateError) {
            console.error('Error updating guild with image:', updateError);
          } else if (updatedData) {
            guildData.image_url = updatedData.image_url;
          }
        }
      }

      // Create a default "general" channel for the new guild
      const defaultChannel = await this.createDefaultChannel(guildData.id);

      // Temporarily pause realtime subscriptions to avoid duplicate notifications
      const tempGuildsSubscription = this.guildsSubscription;
      this.guildsSubscription = null;

      // Manual update instead of waiting for realtime update
      // Check if guild already exists to avoid duplicates
      const exists = this.guilds().some((g) => g.id === guildData.id);
      if (!exists) {
        // Update local state only if it doesn't exist already
        this.guilds.update((guilds) => [...guilds, guildData]);
      }

      // Set this new guild as active
      this.activeGuild.set(guildData);

      // If we successfully created a default channel, set it as active
      if (defaultChannel) {
        // Manually update the channels list with the default channel
        this.channels.set([defaultChannel]);
        this.activeChannel.set(defaultChannel);

        // We'll also pause the channels subscription temporarily to avoid conflicts
        const tempChannelsSubscription = this.channelsSubscription;
        this.channelsSubscription = null;

        // Set up the channels subscription for this guild
        setTimeout(() => {
          this.setupChannelsSubscription(guildData.id);
          this.channelsSubscription = tempChannelsSubscription;
        }, 1000);
      } else {
        this.channels.set([]);
        this.activeChannel.set(null);

        // Try loading channels directly as fallback
        await this.loadChannels(guildData.id);
      }

      // Restore guilds realtime subscription after a short delay
      setTimeout(() => {
        this.guildsSubscription = tempGuildsSubscription;
      }, 1000);

      return guildData;
    } catch (error) {
      console.error('Error in createGuild:', error);
      throw error;
    }
  }

  // Create a default channel for new guilds
  private async createDefaultChannel(guildId: string) {
    if (!this.isBrowser) return null;

    try {
      console.log(`Creating default channel for guild ${guildId}`);
      const { data, error } = await supabase
        .from('channels')
        .insert({
          guild_id: guildId,
          name: 'general',
          description: 'General discussion',
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating default channel:', error);
        return null;
      }

      console.log('Default channel created successfully:', data);
      return data as Channel;
    } catch (error) {
      console.error('Error creating default channel:', error);
      return null;
    }
  }

  async createChannel(guildId: string, name: string, description?: string) {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping createChannel in SSR mode');
      throw new Error('Cannot create channel in server-side rendering');
    }

    try {
      console.log(`Creating new channel: ${name} in guild ${guildId}`);
      const user = this.auth.user();
      if (!user) throw new Error('Not authenticated');

      // Check if the user is the guild owner
      const guild = this.guilds().find((g) => g.id === guildId);
      if (!guild) throw new Error('Guild not found');
      if (guild.owner_id !== user.id) throw new Error('Only the guild owner can create channels');

      // Validate channel name - only letters, numbers, and dashes
      const channelNameRegex = /^[a-zA-Z0-9-]+$/;
      if (!channelNameRegex.test(name)) {
        throw new Error('Channel names can only contain letters, numbers, and dashes');
      }

      // Make sure we have the current auth session token
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('No active session');

      const { data, error } = await supabase
        .from('channels')
        .insert({
          guild_id: guildId,
          name,
          description,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating channel:', error);
        throw error;
      }

      console.log('Channel created successfully:', data);

      // Update local state
      const channelData = data as Channel;
      this.channels.update((channels) => [...channels, channelData]);

      // Set this new channel as active
      this.setActiveChannel(channelData);

      return channelData;
    } catch (error) {
      console.error('Error in createChannel:', error);
      throw error;
    }
  }

  async updateGuild(guildId: string, name: string, description?: string, imageFile?: File) {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping updateGuild in SSR mode');
      throw new Error('Cannot update guild in server-side rendering');
    }

    try {
      console.log(`Updating guild ${guildId}: ${name}`);
      const user = this.auth.user();
      if (!user) throw new Error('Not authenticated');

      // Check if the user is the guild owner
      const guild = this.guilds().find((g) => g.id === guildId);
      if (!guild) throw new Error('Guild not found');
      if (guild.owner_id !== user.id) throw new Error('Only the guild owner can update the guild');

      // Make sure we have the current auth session token
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('No active session');

      // Upload image if provided
      let image_url = guild.image_url;
      if (imageFile) {
        const uploadResult = await this.uploadGuildImage(guildId, imageFile);
        if (uploadResult) {
          image_url = uploadResult;
        }
      }

      const { data, error } = await supabase
        .from('guilds')
        .update({
          name,
          description,
          image_url,
        })
        .eq('id', guildId)
        .select()
        .single();

      if (error) {
        console.error('Error updating guild:', error);
        throw error;
      }

      console.log('Guild updated successfully:', data);

      // Update local state
      const guildData = data as Guild;
      this.guilds.update((guilds) => guilds.map((g) => (g.id === guildId ? guildData : g)));

      // Update active guild if it's the one that was updated
      if (this.activeGuild()?.id === guildId) {
        this.activeGuild.set(guildData);
      }

      return guildData;
    } catch (error) {
      console.error('Error in updateGuild:', error);
      throw error;
    }
  }

  private async uploadGuildImage(guildId: string, file: File): Promise<string | null> {
    if (!this.isBrowser) return null;

    try {
      console.log(`Uploading image for guild ${guildId}`);

      // Validate file type
      if (!file.type.startsWith('image/')) {
        throw new Error('Only image files are allowed');
      }

      // Limit file size (5MB)
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      if (file.size > MAX_SIZE) {
        throw new Error('Image size must be less than 5MB');
      }

      // Generate a unique file path
      // Do not include the guild ID in the filename to avoid policy issues
      // Instead, we'll use a simple timestamp-based filename
      const fileExt = file.name.split('.').pop();
      const timestamp = Date.now();
      const fileName = `${timestamp}.${fileExt}`;
      const filePath = `guild-images/${fileName}`;

      console.log(`Uploading to path: ${filePath}`);

      // Create a data URL for caching before upload
      const dataUrl = await this.fileToDataUrl(file);

      // Upload the file to storage
      const { error: uploadError } = await supabase.storage.from('guilds').upload(filePath, file);

      if (uploadError) {
        console.error('Error uploading guild image:', uploadError);
        throw uploadError;
      }

      // Get the signed URL that works with authenticated access
      const { data } = await supabase.storage.from('guilds').createSignedUrl(filePath, 31536000); // URL valid for 1 year (in seconds)

      if (!data || !data.signedUrl) {
        throw new Error('Could not get signed URL for guild image');
      }

      // Cache the image URL to data URL mapping
      if (dataUrl) {
        this.imageCache.storeImage(data.signedUrl, dataUrl);
      }

      console.log('Guild image uploaded successfully:', data.signedUrl);
      return data.signedUrl;
    } catch (error) {
      console.error('Error in uploadGuildImage:', error);
      return null;
    }
  }

  // Helper method to convert a file to data URL for caching
  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Helper method to refresh a guild image URL if it's expired or close to expiring
  private async refreshGuildImageUrl(guildId: string, currentUrl: string): Promise<string | null> {
    try {
      // Extract the filename from the current URL
      // The URL format is something like: https://...storage.../guilds/guild-images/timestamp.ext?token=...
      const urlParts = currentUrl.split('/');
      const filenameWithParams = urlParts[urlParts.length - 1];
      const filename = filenameWithParams.split('?')[0];

      if (!filename) return null;

      const filePath = `guild-images/${filename}`;

      // Create a new signed URL
      const { data } = await supabase.storage.from('guilds').createSignedUrl(filePath, 31536000); // URL valid for 1 year

      if (!data || !data.signedUrl) {
        console.error('Could not refresh signed URL for guild image');
        return null;
      }

      // Check if we have the old URL cached, and if so, update the cache with the new URL
      try {
        const cachedImage = await this.imageCache.getImage(currentUrl, false);
        if (cachedImage && cachedImage !== currentUrl) {
          // We have a cached version, update it
          this.imageCache.storeImage(data.signedUrl, cachedImage);
        }
      } catch (e) {
        // Ignore errors, just means we don't have it cached
      }

      console.log('Refreshed guild image URL:', data.signedUrl);
      return data.signedUrl;
    } catch (error) {
      console.error('Error refreshing guild image URL:', error);
      return null;
    }
  }

  async deleteGuild(guildId: string) {
    // Skip if not in browser
    if (!this.isBrowser) {
      console.log('Skipping deleteGuild in SSR mode');
      throw new Error('Cannot delete guild in server-side rendering');
    }

    try {
      console.log(`Deleting guild ${guildId}`);
      const user = this.auth.user();
      if (!user) throw new Error('Not authenticated');

      // Check if the user is the guild owner
      const guild = this.guilds().find((g) => g.id === guildId);
      if (!guild) throw new Error('Guild not found');
      if (guild.owner_id !== user.id) throw new Error('Only the guild owner can delete the guild');

      // Make sure we have the current auth session token
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('No active session');

      const { error } = await supabase.from('guilds').delete().eq('id', guildId);

      if (error) {
        console.error('Error deleting guild:', error);
        throw error;
      }

      console.log('Guild deleted successfully');

      // Update local state
      this.guilds.update((guilds) => guilds.filter((g) => g.id !== guildId));

      // If the active guild was deleted, select another one
      if (this.activeGuild()?.id === guildId) {
        const remainingGuilds = this.guilds();
        if (remainingGuilds.length > 0) {
          this.setActiveGuild(remainingGuilds[0]);
        } else {
          this.activeGuild.set(null);
          this.channels.set([]);
          this.activeChannel.set(null);
        }
      }

      return true;
    } catch (error) {
      console.error('Error in deleteGuild:', error);
      throw error;
    }
  }

  async setActiveGuild(guild: Guild) {
    if (!this.isBrowser) return;

    console.log(`Setting active guild: ${guild.name}`);

    // Refresh the guild image URL if needed
    if (guild.image_url && guild.image_url.includes('token=')) {
      const refreshedUrl = await this.refreshGuildImageUrl(guild.id, guild.image_url);
      if (refreshedUrl) {
        guild.image_url = refreshedUrl;

        // Also update the guild in the guilds list
        this.guilds.update((guilds) => guilds.map((g) => (g.id === guild.id ? { ...g, image_url: refreshedUrl } : g)));
      }
    }

    this.activeGuild.set(guild);

    // First clear channels and active channel to avoid displaying old content
    this.channels.set([]);
    this.activeChannel.set(null);

    // Then load the channels for this guild
    await this.loadChannels(guild.id);

    // Setup the realtime subscription for the guild's channels
    this.setupChannelsSubscription(guild.id);
  }

  setActiveChannel(channel: Channel) {
    if (!this.isBrowser) return;

    console.log(`Setting active channel: ${channel.name}`);
    this.activeChannel.set(channel);
  }

  private setupGuildsSubscription() {
    if (!this.isBrowser) return;

    try {
      // Clean up existing subscription if it exists
      if (this.guildsSubscription) {
        this.guildsSubscription.unsubscribe();
        this.guildsSubscription = null;
      }

      const user = this.auth.user();
      if (!user) {
        console.log('Cannot setup guilds subscription: No authenticated user');
        return;
      }

      console.log('Setting up realtime subscription for guilds');
      const realtimeChannelName = `public:guilds:${Date.now()}`;

      this.guildsSubscription = supabase
        .channel(realtimeChannelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'guilds',
          },
          (payload) => {
            try {
              console.log('Received guild event from realtime:', payload);

              // Run inside NgZone to trigger change detection
              this.ngZone.run(() => {
                if (payload.eventType === 'INSERT') {
                  const newGuild = payload.new as Guild;

                  // Check if guild already exists to avoid duplicates
                  const exists = this.guilds().some((g) => g.id === newGuild.id);

                  if (!exists) {
                    console.log('Adding new guild to list:', newGuild);
                    this.guilds.update((guilds) => [...guilds, newGuild]);
                  } else {
                    console.log('Guild already exists, not adding duplicate:', newGuild.id);
                  }
                } else if (payload.eventType === 'UPDATE') {
                  const updatedGuild = payload.new as Guild;

                  this.guilds.update((guilds) => guilds.map((g) => (g.id === updatedGuild.id ? updatedGuild : g)));

                  // Also update activeGuild if needed
                  if (this.activeGuild()?.id === updatedGuild.id) {
                    this.activeGuild.set(updatedGuild);
                  }
                } else if (payload.eventType === 'DELETE') {
                  const deletedGuild = payload.old as Guild;

                  this.guilds.update((guilds) => guilds.filter((g) => g.id !== deletedGuild.id));

                  // If active guild was deleted, reset
                  if (this.activeGuild()?.id === deletedGuild.id) {
                    const remainingGuilds = this.guilds();
                    if (remainingGuilds.length > 0) {
                      this.setActiveGuild(remainingGuilds[0]);
                    } else {
                      this.activeGuild.set(null);
                      this.channels.set([]);
                      this.activeChannel.set(null);
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error processing guilds realtime event:', error);
            }
          }
        )
        .subscribe((status, err) => {
          console.log('Guilds realtime subscription status:', status, err || '');
        });

      console.log('Guilds subscription setup complete');
    } catch (error) {
      console.error('Error setting up guilds subscription:', error);
    }
  }

  private setupChannelsSubscription(guildId: string) {
    if (!this.isBrowser) return;

    try {
      // Clean up existing subscription if it exists
      if (this.channelsSubscription) {
        this.channelsSubscription.unsubscribe();
        this.channelsSubscription = null;
      }

      if (!guildId) {
        console.log('Cannot setup channels subscription: No guild ID provided');
        return;
      }

      console.log(`Setting up realtime subscription for channels in guild ${guildId}`);
      const realtimeChannelName = `public:channels:guild_${guildId}_${Date.now()}`;

      this.channelsSubscription = supabase
        .channel(realtimeChannelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'channels',
            filter: `guild_id=eq.${guildId}`,
          },
          (payload) => {
            try {
              console.log('Received channel event from realtime:', payload);

              // Run inside NgZone to trigger change detection
              this.ngZone.run(() => {
                if (payload.eventType === 'INSERT') {
                  const newChannel = payload.new as Channel;

                  // Check if channel already exists to avoid duplicates
                  const exists = this.channels().some((c) => c.id === newChannel.id);

                  if (!exists) {
                    console.log('Adding new channel to list:', newChannel);
                    this.channels.update((channels) => [...channels, newChannel]);
                  }
                } else if (payload.eventType === 'UPDATE') {
                  const updatedChannel = payload.new as Channel;

                  this.channels.update((channels) =>
                    channels.map((c) => (c.id === updatedChannel.id ? updatedChannel : c))
                  );

                  // Also update activeChannel if needed
                  if (this.activeChannel()?.id === updatedChannel.id) {
                    this.activeChannel.set(updatedChannel);
                  }
                } else if (payload.eventType === 'DELETE') {
                  const deletedChannel = payload.old as Channel;

                  this.channels.update((channels) => channels.filter((c) => c.id !== deletedChannel.id));

                  // If active channel was deleted, reset
                  if (this.activeChannel()?.id === deletedChannel.id) {
                    const remainingChannels = this.channels();
                    if (remainingChannels.length > 0) {
                      this.setActiveChannel(remainingChannels[0]);
                    } else {
                      this.activeChannel.set(null);
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error processing channels realtime event:', error);
            }
          }
        )
        .subscribe((status, err) => {
          console.log('Channels realtime subscription status:', status, err || '');
        });

      console.log('Channels subscription setup complete');
    } catch (error) {
      console.error('Error setting up channels subscription:', error);
    }
  }

  ngOnDestroy() {
    // Clean up subscriptions when service is destroyed
    if (this.isBrowser) {
      console.log('Guild service destroying - cleaning up subscriptions');

      if (this.guildsSubscription) {
        this.guildsSubscription.unsubscribe();
        this.guildsSubscription = null;
      }

      if (this.channelsSubscription) {
        this.channelsSubscription.unsubscribe();
        this.channelsSubscription = null;
      }
    }
  }
}
