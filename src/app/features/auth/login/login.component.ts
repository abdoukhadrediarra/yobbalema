import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthLayoutComponent } from '../../../shared/auth-layout/auth-layout.component';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AuthLayoutComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(private supabase: SupabaseService, private router: Router) {}

  async onSubmit() {
    this.errorMessage.set(null);
    this.loading.set(true);
    try {
      await this.supabase.signIn(this.email, this.password);
      this.router.navigateByUrl('/tableau-de-bord');
    } catch (err) {
      this.errorMessage.set(this.translateError(err));
    } finally {
      this.loading.set(false);
    }
  }

  private translateError(err: unknown): string {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('Invalid login credentials')) {
      return 'Adresse e-mail ou mot de passe incorrect.';
    }
    if (message.includes('Email not confirmed')) {
      return 'Confirmez votre adresse e-mail avant de vous connecter.';
    }
    return "La connexion a échoué. Vérifiez votre connexion et réessayez.";
  }
}
