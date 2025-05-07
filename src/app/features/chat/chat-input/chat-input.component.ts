import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ChatService } from 'src/app/features/chat/chat.service';

@Component({
  selector: 'chat-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-input.component.html',
})
export class ChatInputComponent {
  text = '';

  constructor(private chat: ChatService) {}

  async send() {
    const content = this.text.trim();
    if (!content) return;
    await this.chat.send(content);
    this.text = '';
  }
}
