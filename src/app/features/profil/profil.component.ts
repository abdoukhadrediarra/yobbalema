import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryService } from '../../core/services/delivery.service';
import { ProfileService } from '../../core/services/profile.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { messageErreur } from '../../core/util/format';
import { StarsComponent } from '../../shared/stars/stars.component';
import { environment } from '../../../environments/environment';

const ROLES: Record<string, string> = { client: 'Passager', chauffeur: 'Chauffeur', receveur_bus: 'Receveur de bus', commercant: 'Commerçant' };

@Component({
  selector: 'app-profil',
  standalone: true,
  imports: [FormsModule, StarsComponent],
  template: `
<section class="page">
  <div class="container" style="max-width:860px">
    <header class="page-head">
      <div><h1>Mon profil</h1><p>Vos informations et la vérification de votre identité.</p></div>
    </header>

    <div class="stack stack--lg">
      <form class="card stack" (ngSubmit)="save()">
        <h2>Informations</h2>
        <div class="row" style="align-items:flex-start">
          <div class="field" style="flex:1;min-width:180px"><label for="prenom">Prénom</label><input id="prenom" name="prenom" [ngModel]="prenom()" (ngModelChange)="prenom.set($event)" required></div>
          <div class="field" style="flex:1;min-width:180px"><label for="nom">Nom</label><input id="nom" name="nom" [ngModel]="nom()" (ngModelChange)="nom.set($event)" required></div>
        </div>
        <div class="field"><label for="tel">Téléphone</label><input id="tel" name="tel" type="tel" [ngModel]="tel()" (ngModelChange)="tel.set($event)" placeholder="+221 77 000 00 00"></div>
        <dl class="kv">
          <dt>E-mail</dt><dd>{{ sb.currentUser()?.email }}</dd>
          <dt>Type de compte</dt><dd>{{ roleLabel() }}</dd>
          @if (sb.currentProfile()?.note_moyenne; as n) { <dt>Votre note</dt><dd><app-stars [value]="n" [readonly]="true" /></dd> }
        </dl>
        <div><button class="btn btn--ink" type="submit" [disabled]="busy() === 'save'">Enregistrer</button></div>
      </form>

      <form class="card stack" (ngSubmit)="changePassword()">
        <h2>Sécurité</h2>
        <div class="row" style="align-items:flex-start">
          <div class="field" style="flex:1;min-width:180px"><label for="npw">Nouveau mot de passe</label><input id="npw" name="npw" type="password" minlength="8" autocomplete="new-password" [ngModel]="pw()" (ngModelChange)="pw.set($event)"></div>
          <div class="field" style="flex:1;min-width:180px"><label for="npw2">Confirmer</label><input id="npw2" name="npw2" type="password" minlength="8" autocomplete="new-password" [ngModel]="pw2()" (ngModelChange)="pw2.set($event)"></div>
        </div>
        <div><button class="btn btn--outline" type="submit" [disabled]="busy() === 'pw' || pw().length < 8">Changer le mot de passe</button></div>

        @if (smsOtp) {
          <hr style="border:none;border-top:1px solid var(--color-paper-line);width:100%">
          <strong class="small">Vérifier mon numéro de téléphone par SMS</strong>
          <div class="row" style="align-items:flex-end">
            <div class="field" style="flex:1;min-width:200px"><label for="ph">Numéro (format international)</label><input id="ph" name="ph" type="tel" placeholder="+221771234567" [ngModel]="phone()" (ngModelChange)="phone.set($event)"></div>
            <button type="button" class="btn btn--outline btn--sm" (click)="sendCode()" [disabled]="busy() === 'sms' || phone().length < 8">Envoyer le code</button>
          </div>
          @if (codeSent()) {
            <div class="row" style="align-items:flex-end">
              <div class="field"><label for="otp">Code reçu par SMS</label><input id="otp" name="otp" inputmode="numeric" maxlength="8" [ngModel]="otp()" (ngModelChange)="otp.set($event)"></div>
              <button type="button" class="btn btn--ink btn--sm" (click)="verifyCode()" [disabled]="busy() === 'otp' || otp().length < 4">Valider</button>
            </div>
          }
        }
      </form>

      <div class="card stack">
        <div class="row row--between">
          <h2 class="mb-0">Vérification d’identité</h2>
          <span [class]="statut() === 'verifie' ? 'tag tag--ok' : statut() === 'rejete' ? 'tag tag--bad' : 'tag tag--wait'">
            {{ statut() === 'verifie' ? 'Vérifié' : statut() === 'rejete' ? 'Refusé' : 'En attente' }}</span>
        </div>
        <p class="small muted mb-0">Ajoutez vos documents : un administrateur Yobbalema les examine, puis valide votre compte. Vos pièces sont stockées de façon privée : vous seul et l’équipe de vérification y avez accès.</p>

        <div class="cols-2">
          <div class="stack" style="--gap:.6rem">
            <strong class="small">Carte d’identité (CNI) ou passeport</strong>
            @if (sb.currentProfile()?.cni_url) {
              <span class="tag tag--ok" style="align-self:flex-start"><i class="bi bi-check2"></i> Document envoyé</span>
              <button class="btn btn--outline btn--sm" style="align-self:flex-start" (click)="view('cni')"><i class="bi bi-eye"></i> Voir</button>
            }
            <input type="file" accept="image/*,application/pdf" (change)="upload('cni', $any($event.target).files?.[0] ?? null)" [disabled]="busy() === 'cni'" aria-label="Envoyer la pièce d’identité">
            @if (busy() === 'cni') { <span class="xs muted">Envoi en cours…</span> }
          </div>
          @if (sb.currentProfile()?.role === 'chauffeur') {
            <div class="stack" style="--gap:.6rem">
              <strong class="small">Permis de conduire</strong>
              @if (sb.currentProfile()?.permis_url) {
                <span class="tag tag--ok" style="align-self:flex-start"><i class="bi bi-check2"></i> Document envoyé</span>
                <button class="btn btn--outline btn--sm" style="align-self:flex-start" (click)="view('permis')"><i class="bi bi-eye"></i> Voir</button>
              }
              <input type="file" accept="image/*,application/pdf" (change)="upload('permis', $any($event.target).files?.[0] ?? null)" [disabled]="busy() === 'permis'" aria-label="Envoyer le permis de conduire">
              @if (busy() === 'permis') { <span class="xs muted">Envoi en cours…</span> }
            </div>
          }
        </div>
      </div>
    </div>
  </div>
</section>
  `,
})
export class ProfilComponent implements OnInit {
  readonly busy = signal<string | null>(null);
  readonly prenom = signal('');
  readonly nom = signal('');
  readonly tel = signal('');
  readonly pw = signal('');
  readonly pw2 = signal('');
  readonly phone = signal('');
  readonly otp = signal('');
  readonly codeSent = signal(false);
  readonly smsOtp = (environment as { smsOtpEnabled?: boolean }).smsOtpEnabled === true;
  readonly statut = computed(() => this.sb.currentProfile()?.statut_verif ?? 'en_attente');
  readonly roleLabel = computed(() => ROLES[this.sb.currentProfile()?.role ?? 'client'] ?? '');

  constructor(public sb: SupabaseService, private profiles: ProfileService, private delivery: DeliveryService, private toast: ToastService) {}

  ngOnInit() {
    const p = this.sb.currentProfile();
    this.prenom.set(p?.prenom ?? ''); this.nom.set(p?.nom ?? ''); this.tel.set(p?.telephone ?? '');
  }

  async save() {
    this.busy.set('save');
    try { await this.profiles.update({ prenom: this.prenom().trim(), nom: this.nom().trim(), telephone: this.tel().trim() }); this.toast.ok('Profil mis à jour.'); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(null); }
  }

  async changePassword() {
    if (this.pw() !== this.pw2()) { this.toast.error('Les deux mots de passe ne correspondent pas.'); return; }
    this.busy.set('pw');
    try { await this.sb.updatePassword(this.pw()); this.pw.set(''); this.pw2.set(''); this.toast.ok('Mot de passe modifié.'); }
    catch (e) { this.toast.error(messageErreur(e, 'Changement impossible. Choisissez un mot de passe différent et plus long.')); }
    finally { this.busy.set(null); }
  }

  async sendCode() {
    this.busy.set('sms');
    try { await this.sb.requestPhoneOtp(this.phone().trim()); this.codeSent.set(true); this.toast.ok('Code envoyé par SMS.'); }
    catch (e) { this.toast.error(messageErreur(e, 'Envoi du SMS impossible : le fournisseur SMS n’est peut-être pas configuré.')); }
    finally { this.busy.set(null); }
  }

  async verifyCode() {
    this.busy.set('otp');
    try { await this.sb.verifyPhoneOtp(this.phone().trim(), this.otp().trim()); this.codeSent.set(false); this.otp.set(''); this.toast.ok('Numéro vérifié.'); }
    catch (e) { this.toast.error(messageErreur(e, 'Code incorrect ou expiré.')); }
    finally { this.busy.set(null); }
  }

  async upload(kind: 'cni' | 'permis', file: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { this.toast.error('Fichier trop volumineux (5 Mo maximum).'); return; }
    this.busy.set(kind);
    try { await this.profiles.uploadDocument(kind, file); this.toast.ok('Document envoyé. Il sera examiné par l’équipe Yobbalema.'); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(null); }
  }

  async view(kind: 'cni' | 'permis') {
    const path = kind === 'cni' ? this.sb.currentProfile()?.cni_url : this.sb.currentProfile()?.permis_url;
    if (!path) return;
    const url = await this.delivery.signedUrl('documents', path);
    if (url) window.open(url, '_blank', 'noopener'); else this.toast.error('Impossible d’ouvrir le document.');
  }
}
