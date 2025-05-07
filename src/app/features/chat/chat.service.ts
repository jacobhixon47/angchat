// src/app/features/chat/chat.service.ts
import { Injectable, signal, inject, NgZone, OnDestroy, effect, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { supabase } from '../../../app/core/supabase.client';
import { AuthService, User } from '../../../app/core/auth.service';
import { RealtimeChannel } from '@supabase/supabase-js';
import { GuildService } from '../guild/guild.service';

export interface Message {
  id: number;
  user_id: string;
  content: string;
  inserted_at: string;
  channel_id?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private auth = inject(AuthService);
  private guildService = inject(GuildService);
  private ngZone = inject(NgZone);
  private isBrowser: boolean;

  messages = signal<Message[]>([]);
  private channelSubscription: RealtimeChannel | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: any = null;
  private connectionCheckInterval: any = null;
  private isSettingUpSubscription = false;

  // Add message cache by channel
  private messageCache: Record<string, Message[]> = {};
  private lastMessageTimestamp: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) {
      console.log('ChatService running in SSR mode - limited functionality');
      return;
    }

    try {
      console.log('ChatService initializing in browser');

      // Setup effect to listen for active channel changes
      effect(() => {
        const activeChannel = this.guildService.activeChannel();
        if (activeChannel) {
          console.log(`Active channel changed to: ${activeChannel.name}`);

          // Check if we have cached messages for this channel
          if (this.messageCache[activeChannel.id]) {
            console.log(`Using cached messages for channel ${activeChannel.id}`);
            this.messages.set(this.messageCache[activeChannel.id]);

            // In background, check for new messages since last cached timestamp
            this.loadNewMessagesForChannel(activeChannel.id);
          } else {
            // No cache, load all messages
            this.loadMessages(activeChannel.id);
          }

          this.safeSetupRealtimeSubscription(activeChannel.id);
        } else {
          console.log('No active channel selected');
          this.safeRemoveRealtimeSubscription();
          this.messages.set([]); // Clear messages when no channel selected
        }
      });

      // Check connection status periodically (less frequently)
      this.connectionCheckInterval = setInterval(() => {
        this.checkConnectionStatus();
      }, 60000); // Check every 60 seconds instead of 30
    } catch (error) {
      console.error('Error in ChatService constructor:', error);
    }
  }

  ngOnDestroy() {
    if (!this.isBrowser) return;

    this.safeRemoveRealtimeSubscription();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  private async checkConnectionStatus() {
    if (!this.isBrowser) return;

    try {
      if (!this.channelSubscription && !this.isSettingUpSubscription) {
        console.log('Connection check: Not subscribed, attempting to reconnect');
        const activeChannel = this.guildService.activeChannel();
        if (activeChannel) {
          this.safeSetupRealtimeSubscription(activeChannel.id);
        } else {
          console.log('No active channel to subscribe to');
        }
      }
    } catch (error) {
      console.error('Error in checkConnectionStatus:', error);
    }
  }

  /**
   * Load only new messages for a channel since the last cached message
   */
  private async loadNewMessagesForChannel(channelId: string) {
    if (!this.isBrowser) return;

    if (!channelId || !this.lastMessageTimestamp[channelId]) {
      return;
    }

    const lastTimestamp = this.lastMessageTimestamp[channelId];
    console.log(`Checking for new messages in channel ${channelId} since ${lastTimestamp}`);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select()
        .eq('channel_id', channelId)
        .gt('inserted_at', lastTimestamp)
        .order('inserted_at', { ascending: true });

      if (error) {
        console.error('Error loading new messages:', error);
        return;
      }

      if (data && data.length > 0) {
        console.log(`Loaded ${data.length} new messages from database`);

        // Update cache and timestamp
        const cachedMessages = this.messageCache[channelId] || [];
        const newMessageIds = new Set(data.map((m) => m.id));

        // Filter out duplicates and combine with new messages
        const updatedMessages = [...cachedMessages.filter((m) => !newMessageIds.has(m.id)), ...data].sort((a, b) => {
          return new Date(a.inserted_at).getTime() - new Date(b.inserted_at).getTime();
        });

        // Update cache
        this.messageCache[channelId] = updatedMessages;
        this.messages.set(updatedMessages);

        // Update last timestamp
        if (data.length > 0) {
          const timestamps = data.map((m) => m.inserted_at);
          const latestTimestamp = timestamps.reduce((latest, current) => {
            return new Date(current) > new Date(latest) ? current : latest;
          }, timestamps[0]);

          this.lastMessageTimestamp[channelId] = latestTimestamp;
        }
      } else {
        console.log('No new messages found');
      }
    } catch (err) {
      console.error('Exception loading new messages:', err);
    }
  }

  private async loadMessages(channelId: string) {
    if (!this.isBrowser) return;

    if (!channelId) {
      console.log('Cannot load messages: No channel ID provided');
      this.messages.set([]);
      return;
    }

    console.log(`Loading messages for channel ${channelId} from database`);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select()
        .eq('channel_id', channelId)
        .order('inserted_at', { ascending: true });

      if (error) {
        console.error('Error loading messages:', error);
        this.messages.set([]);
        return;
      }

      if (data) {
        console.log(`Loaded ${data.length} messages from database`);

        // Cache messages for this channel
        this.messageCache[channelId] = [...data];
        this.messages.set(data || []);

        // Store the latest message timestamp for incremental loading
        if (data.length > 0) {
          const timestamps = data.map((m) => m.inserted_at);
          const latestTimestamp = timestamps.reduce((latest, current) => {
            return new Date(current) > new Date(latest) ? current : latest;
          }, timestamps[0]);

          this.lastMessageTimestamp[channelId] = latestTimestamp;
        }
      } else {
        this.messages.set([]);
      }
    } catch (err) {
      console.error('Exception loading messages:', err);
      this.messages.set([]);
    }
  }

  private safeRemoveRealtimeSubscription() {
    if (!this.isBrowser) return;

    try {
      if (this.channelSubscription) {
        console.log('Removing existing subscription');
        this.channelSubscription.unsubscribe();
        this.channelSubscription = null;
      }
    } catch (error) {
      console.error('Error removing subscription:', error);
      // Force reset the channel subscription
      this.channelSubscription = null;
    }
  }

  private async safeSetupRealtimeSubscription(channelId: string) {
    if (!this.isBrowser) return;

    if (this.isSettingUpSubscription) {
      console.log('Already setting up subscription, skipping...');
      return;
    }

    this.isSettingUpSubscription = true;

    try {
      await this.setupRealtimeSubscription(channelId);
    } catch (error) {
      console.error('Error in safeSetupRealtimeSubscription:', error);
    } finally {
      this.isSettingUpSubscription = false;
    }
  }

  public async setupRealtimeSubscription(channelId: string) {
    if (!this.isBrowser) return;

    // Clean up existing subscription if it exists
    this.safeRemoveRealtimeSubscription();

    if (!channelId) {
      console.log('Cannot setup realtime subscription: No channel ID provided');
      return;
    }

    console.log(`Setting up realtime subscription for channel ${channelId}`);

    try {
      // Create a new channel with a unique name
      const realtimeChannelName = `public:messages:channel_${channelId}_${Date.now()}`;
      console.log(`Creating channel: ${realtimeChannelName}`);

      this.channelSubscription = supabase
        .channel(realtimeChannelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `channel_id=eq.${channelId}`,
          },
          (payload) => {
            try {
              console.log('Received event from realtime:', payload);

              if (payload.eventType !== 'INSERT') {
                console.log(`Ignoring ${payload.eventType} event`);
                return;
              }

              // Run inside NgZone to trigger change detection
              this.ngZone.run(() => {
                const newMsg = payload.new as Message;

                // Check if message already exists to avoid duplicates
                const exists = this.messages().some((m) => m.id === newMsg.id);

                if (!exists) {
                  console.log('Adding new message to list:', newMsg);
                  this.messages.update((msgs) => [...msgs, newMsg]);
                } else {
                  console.log('Message already exists, not adding');
                }
              });
            } catch (error) {
              console.error('Error processing realtime event:', error);
            }
          }
        )
        .subscribe((status, err) => {
          console.log('Realtime subscription status:', status, err || '');

          if (status === 'SUBSCRIBED') {
            console.log('Successfully subscribed to realtime updates');
            // Reset reconnect attempts on successful subscription
            this.reconnectAttempts = 0;

            // Test the subscription by querying the messages table
            const activeChannel = this.guildService.activeChannel();
            if (activeChannel) {
              this.loadMessages(activeChannel.id).then(() => {
                console.log('Reloaded messages after subscription');
              });
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`Channel ${status}, attempting to reconnect`);
            this.safeScheduleReconnect();
          }
        });

      console.log('Subscription setup complete');
    } catch (error) {
      console.error('Error setting up realtime subscription:', error);
      this.safeScheduleReconnect();
    }
  }

  private safeScheduleReconnect() {
    if (!this.isBrowser) return;

    try {
      this.scheduleReconnect();
    } catch (error) {
      console.error('Error in safeScheduleReconnect:', error);
    }
  }

  private scheduleReconnect() {
    if (!this.isBrowser) return;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
      console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

      this.reconnectTimeout = setTimeout(() => {
        console.log(`Reconnect attempt ${this.reconnectAttempts}`);
        const activeChannel = this.guildService.activeChannel();
        if (activeChannel) {
          this.safeSetupRealtimeSubscription(activeChannel.id);
        } else {
          console.log('Cannot reconnect: No active channel');
          // Reset the reconnect attempts when we have no channel to reconnect to
          this.reconnectAttempts = 0;
        }
      }, delay);
    } else {
      console.error(`Exceeded maximum reconnect attempts (${this.maxReconnectAttempts}). Please reload the page.`);
    }
  }

  /** Send message to the current active channel */
  async send(content: string) {
    if (!content.trim() || !this.isBrowser) return;

    const activeChannel = this.guildService.activeChannel();
    if (!activeChannel) {
      console.error('Cannot send message: No active channel');
      return;
    }

    const user = this.auth.user();
    if (!user) {
      console.error('Cannot send message: No authenticated user');
      return;
    }

    try {
      const currentTime = new Date().toISOString();

      // Actually send the message to the database first
      const { data, error } = await supabase.from('messages').insert([
        {
          user_id: user.id,
          content: content,
          channel_id: activeChannel.id,
        },
      ]);

      if (error) {
        console.error('Error sending message:', error);
        throw error;
      }

      console.log('Message sent successfully');
    } catch (error) {
      console.error('Exception sending message:', error);
    }
  }
}
