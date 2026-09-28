import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthLayoutComponent } from '../../shared/auth-layout/auth-layout.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink, AuthLayoutComponent],
  template: `
<app-auth-layout titre="Mot de passe oublié" sousTitre="Indiquez votre adresse e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.">
  @if (sent()) {
    <div class="alert alert--ok"><i class="bi bi-envelope-check"></i><p>Si un compte existe pour <strong>{{ email }}</strong>, un e-mail vient de partir. Ouvrez le lien qu'il contient (vérifiez aussi les courriers indésirables).</p></div>
  } @else {
    <form (ngSubmit)="submit()" #f="ngForm">
      <div class="field"><label for="email">Adresse e-mail</label>
        <input id="email" name="email" type="email" required autocomplete="email" [(ngModel)]="email" placeholder="vous@exemple.com"></div>
      @if (error()) { <p class="field-error"><i class="bi bi-exclamation-circle"></i> {{ error() }}</p> }
      <button type="submit" class="btn btn--gold btn--block btn--lg" [disabled]="loading() || f.invalid">{{ loading() ? 'Envoi…' : 'Envoyer le lien' }}</button>
    </form>
  }
  <p class="auth__switch"><a routerLink="/connexion">Retour à la connexion</a></p>
</app-auth-layout>
  `,
})
export class ForgotPasswordComponent {
  email = '';
  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');
  constructor(private sb: SupabaseService) {}

  async submit() {
    this.loading.set(true); this.error.set('');
    try { await this.sb.resetPassword(this.email.trim()); this.sent.set(true); }
    catch (e) {
      const m = (e as Error)?.message ?? '';
      this.error.set(m.toLowerCase().includes('rate') ? 'Trop de demandes : patientez quelques minutes avant de réessayer.' : "Envoi impossible pour le moment. Réessayez plus tard.");
    } finally { this.loading.set(false); }
  }
}
