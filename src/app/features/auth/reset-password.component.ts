import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuthLayoutComponent } from '../../shared/auth-layout/auth-layout.component';

/** Page d'arrivée du lien reçu par e-mail : Supabase ouvre alors une session de récupération. */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink, AuthLayoutComponent],
  template: `
<app-auth-layout titre="Nouveau mot de passe" sousTitre="Choisissez un mot de passe d'au moins 8 caractères.">
  @if (!ready()) {
    <div class="alert alert--warn"><i class="bi bi-hourglass-split"></i><p>Vérification du lien… S'il ne fonctionne pas, il a peut-être expiré : <a routerLink="/mot-de-passe-oublie" class="strong">demandez-en un nouveau</a>.</p></div>
  } @else {
    <form (ngSubmit)="submit()" #f="ngForm">
      <div class="field"><label for="pw">Nouveau mot de passe</label><input id="pw" name="pw" type="password" minlength="8" required autocomplete="new-password" [(ngModel)]="password"></div>
      <div class="field"><label for="pw2">Confirmer</label><input id="pw2" name="pw2" type="password" minlength="8" required autocomplete="new-password" [(ngModel)]="confirm"></div>
      @if (error()) { <p class="field-error"><i class="bi bi-exclamation-circle"></i> {{ error() }}</p> }
      <button type="submit" class="btn btn--gold btn--block btn--lg" [disabled]="loading() || f.invalid">{{ loading() ? 'Enregistrement…' : 'Enregistrer' }}</button>
    </form>
  }
</app-auth-layout>
  `,
})
export class ResetPasswordComponent implements OnInit {
  password = ''; confirm = '';
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  constructor(private sb: SupabaseService, private router: Router) {}

  async ngOnInit() {
    // Le client Supabase lit le jeton dans l'URL et ouvre la session ; on attend un instant qu'elle soit prête.
    for (let i = 0; i < 40; i++) {
      if (this.sb.currentUser()) { this.ready.set(true); return; }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async submit() {
    if (this.password !== this.confirm) { this.error.set('Les deux mots de passe ne correspondent pas.'); return; }
    this.loading.set(true); this.error.set('');
    try { await this.sb.updatePassword(this.password); this.router.navigateByUrl('/tableau-de-bord'); }
    catch (e) {
      const m = (e as Error)?.message ?? '';
      this.error.set(m.includes('different') ? "Choisissez un mot de passe différent de l'ancien." : m.toLowerCase().includes('weak') ? 'Mot de passe trop faible : ajoutez des chiffres ou des lettres.' : 'Changement impossible. Le lien a peut-être expiré.');
    } finally { this.loading.set(false); }
  }
}
