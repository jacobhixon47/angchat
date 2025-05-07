import { Component, OnInit, OnDestroy, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ChatListComponent } from 'src/app/features/chat/chat-list/chat-list.component';
import { ChatInputComponent } from 'src/app/features/chat/chat-input/chat-input.component';
import { ChatService } from '../chat.service';
import { GuildSidebarComponent } from 'src/app/features/guild/guild-sidebar/guild-sidebar.component';
import { ChannelListComponent } from 'src/app/features/guild/channel-list/channel-list.component';
import { GuildService } from '../../guild/guild.service';
import { ProfileComponent } from '../../auth/profile/profile.component';
import { AuthService } from 'src/app/core/auth.service';
import { supabase } from 'src/app/core/supabase.client';

@Component({
  selector: 'chat-page',
  standalone: true,
  imports: [
    CommonModule,
    ChatListComponent,
    ChatInputComponent,
    GuildSidebarComponent,
    ChannelListComponent,
    ProfileComponent,
  ],
  template: `
    <div class="flex h-screen w-full bg-gray-900 text-white">
      <!-- Guild sidebar -->
      <guild-sidebar></guild-sidebar>

      <!-- Channel list -->
      <channel-list></channel-list>

      <!-- Chat area -->
      <div class="flex-1 flex flex-col">
        <!-- Show welcome message if no active guild/channel or in SSR mode -->
        <div *ngIf="!isBrowser || !hasActiveChannel()" class="flex-1 flex items-center justify-center">
          <div class="text-center text-gray-400 p-6 max-w-md">
            <h2 class="text-xl font-semibold mb-4">Welcome to AngChat!</h2>
            <p class="mb-4">Get started by:</p>
            <ul class="text-left text-sm list-disc pl-6 mb-4">
              <li class="mb-2">Creating a new guild (click the + button in the sidebar)</li>
              <li class="mb-2">Creating a new channel (click the Create Channel button)</li>
              <li class="mb-2">Inviting friends to join your guild</li>
            </ul>
            <p>Happy chatting!</p>
          </div>
        </div>

        <!-- Show chat messages if we have an active channel and not in SSR -->
        <chat-list *ngIf="isBrowser && hasActiveChannel()" class="flex-1"></chat-list>
        <chat-input *ngIf="isBrowser && hasActiveChannel()"></chat-input>
      </div>

      <!-- User profile button -->
      <div class="fixed bottom-4 left-0 w-20 flex justify-center z-40">
        <button
          (click)="openProfile()"
          class="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold hover:opacity-80 transition-all overflow-hidden shadow-lg border-2 border-gray-700"
          [title]="getUserName()"
        >
          <img *ngIf="avatarUrl" [src]="avatarUrl" class="h-full w-full object-cover" alt="Profile" />
          <div *ngIf="!avatarUrl" class="h-full w-full bg-purple-600 flex items-center justify-center">
            {{ getInitial() }}
          </div>
        </button>
      </div>
    </div>

    <!-- Profile Modal -->
    <app-profile #profileModal (profileUpdated)="fetchUserAvatar()"></app-profile>
  `,
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('profileModal') profileModal!: ProfileComponent;
  avatarUrl: string | null = null;
  isBrowser: boolean;

  constructor(
    private chatService: ChatService,
    public guildService: GuildService,
    public auth: AuthService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    if (!this.isBrowser) {
      console.log('Chat component running in SSR mode - limited functionality');
      return;
    }

    console.log('Chat component initialized in browser');
    this.fetchUserAvatar();
  }

  ngOnDestroy() {
    if (!this.isBrowser) return;

    console.log('Chat component destroyed');
  }

  hasActiveChannel(): boolean {
    if (!this.isBrowser) return false;
    return !!this.guildService.activeChannel();
  }

  getUserName(): string {
    if (!this.isBrowser) return 'Profile';
    return this.auth.user()?.username || 'Profile';
  }

  getInitial(): string {
    if (!this.isBrowser) return 'A';
    return this.auth.user()?.username?.charAt(0)?.toUpperCase() || 'A';
  }

  openProfile() {
    if (!this.isBrowser) return;
    this.profileModal.open();
  }

  async fetchUserAvatar() {
    if (!this.isBrowser) return;

    const userId = this.auth.user()?.id;
    if (!userId) return;

    try {
      const { data, error } = await supabase.from('profiles').select('avatar_url').eq('id', userId).single();

      if (error) throw error;

      if (data?.avatar_url) {
        const { data: signedUrl } = await supabase.storage.from('avatars').createSignedUrl(data.avatar_url, 3600);

        if (signedUrl) {
          this.avatarUrl = signedUrl.signedUrl;
        }
      }
    } catch (error) {
      console.error('Error fetching avatar:', error);
    }
  }
}
