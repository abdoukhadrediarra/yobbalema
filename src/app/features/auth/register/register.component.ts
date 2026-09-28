import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthLayoutComponent } from '../../../shared/auth-layout/auth-layout.component';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Role } from '../../../core/models/models';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AuthLayoutComponent],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  prenom = '';
  nom = '';
  telephone = '';
  email = '';
  password = '';
  role: Role = 'client';

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly technicalDetail = signal<string | null>(null);
  readonly done = signal(false);

  constructor(private supabase: SupabaseService, private router: Router) {}

  async onSubmit() {
    this.errorMessage.set(null);
    this.technicalDetail.set(null);
    this.loading.set(true);
    try {
      const result = await this.supabase.signUp({
        email: this.email,
        password: this.password,
        prenom: this.prenom,
        nom: this.nom,
        telephone: this.telephone,
        role: this.role,
      });

      if (result.session) {
        // Confirmation e-mail désactivée sur ce projet Supabase : session immédiate.
        this.router.navigateByUrl('/tableau-de-bord');
      } else {
        // Confirmation e-mail activée : on informe la personne plutôt que de la bloquer.
        this.done.set(true);
      }
    } catch (err) {
      this.errorMessage.set(this.translateError(err));
    } finally {
      this.loading.set(false);
    }
  }

  private translateError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err ?? '');
    const status = (err as { status?: number })?.status;

    // On garde toujours le détail technique visible pendant le développement.
    console.error('[signUp] erreur Supabase :', err);
    this.technicalDetail.set(status ? `${message} (HTTP ${status})` : message);

    const lower = message.toLowerCase();
    if (lower.includes('rate limit')) {
      return "Trop de tentatives d'envoi d'e-mail. Attendez un peu, ou désactivez « Confirm email » dans Supabase (Authentication > Providers > Email) pendant vos tests.";
    }
    if (lower.includes('already registered') || lower.includes('already exists')) {
      return 'Un compte existe déjà avec cette adresse e-mail.';
    }
    if (lower.includes('password should be') || lower.includes('weak password')) {
      return 'Mot de passe trop faible : utilisez au moins 8 caractères.';
    }
    if (lower.includes('invalid') && lower.includes('email')) {
      return "Cette adresse e-mail n'est pas acceptée. Utilisez une vraie adresse e-mail.";
    }
    if (lower.includes('database error saving new user')) {
      return "Le compte n'a pas pu être enregistré côté base de données (trigger handle_new_user). Voir le détail ci-dessous.";
    }
    if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
      return "Impossible de joindre Supabase. Vérifiez supabaseUrl et supabaseAnonKey dans src/environments/environment.ts, puis relancez ng serve.";
    }
    return "L'inscription a échoué. Détail technique ci-dessous.";
  }
}
