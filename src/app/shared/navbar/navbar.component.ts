import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AdminService } from '../../core/services/admin.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, NotificationBellComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
})
export class NavbarComponent {
  readonly menuOpen = signal(false);

  constructor(public supabase: SupabaseService, public admin: AdminService) {}

  toggleMenu() {
    this.menuOpen.update((v) => !v);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  async logout() {
    await this.supabase.signOut();
    this.closeMenu();
  }
}
