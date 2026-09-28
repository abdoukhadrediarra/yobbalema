import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminStats, PricingConfig, Profile } from '../../core/models/models';
import { AdminService, LedgerWithDriver, MerchantWithOwner, SoldeARerser } from '../../core/services/admin.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_CATEGORIE, fcfa, messageErreur } from '../../core/util/format';

type Tab = 'stats' | 'verifs' | 'commerces' | 'dettes' | 'versements' | 'reglages';
const ROLES: Record<string, string> = { client: 'Passager', chauffeur: 'Chauffeur', receveur_bus: 'Receveur', commercant: 'Commerçant' };

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head"><div><h1>Administration</h1><p>Vérifications, commissions, réglages et statistiques de la plateforme.</p></div></header>

    <div class="tabs" role="tablist">
      @for (t of tabs; track t.id) {
        <button class="tab" [class.tab--active]="tab() === t.id" (click)="open(t.id)" role="tab">
          {{ t.nom }} @if (badge(t.id); as b) { <span class="tag tag--wait" style="margin-left:.4rem">{{ b }}</span> }
        </button>
      }
    </div>

    @if (tab() === 'stats') {
      @if (stats(); as s) {
        <div class="cols-3">
          <div class="card"><span class="xs muted">Volume de paiements</span><div class="price">{{ fcfa(s.volume_paiements) }}</div></div>
          <div class="card"><span class="xs muted">Commissions générées (5 %)</span><div class="price">{{ fcfa(s.commissions_generees) }}</div></div>
          <div class="card"><span class="xs muted">Dettes de commission en cours</span><div class="price" [style.color]="s.dettes_en_cours > 0 ? 'var(--color-rust-deep)' : ''">{{ fcfa(s.dettes_en_cours) }}</div><span class="xs muted">{{ s.chauffeurs_bloques }} chauffeur(s) bloqué(s)</span></div>
          <div class="card"><span class="xs muted">Courses terminées</span><div class="price">{{ s.courses_terminees }}</div><span class="xs muted">{{ s.courses_aujourdhui }} aujourd'hui · {{ s.courses_en_attente }} en attente</span></div>
          <div class="card"><span class="xs muted">Livraisons livrées</span><div class="price">{{ s.livraisons_livrees }}</div></div>
          <div class="card"><span class="xs muted">Trajets à venir · Bus actifs</span><div class="price">{{ s.trajets_ouverts }} · {{ s.bus_actifs }}</div></div>
          <div class="card"><span class="xs muted">À reverser aux chauffeurs et commerçants</span><div class="price">{{ fcfa(s.a_verser_total) }}</div><span class="xs muted">onglet Versements</span></div>
          <div class="card"><span class="xs muted">Paiements en ligne en attente</span><div class="price">{{ s.paiements_en_attente }}</div></div>
          <div class="card" [style.borderColor]="(s.anomalies_paiement + s.comptes_suspendus) > 0 ? 'var(--color-gold-deep)' : ''"><span class="xs muted">Anomalies de paiement · Comptes suspendus</span><div class="price">{{ s.anomalies_paiement }} · {{ s.comptes_suspendus }}</div><span class="xs muted">montant incohérent ou doublon à vérifier</span></div>
        </div>
        <div class="card mt-2">
          <h2>Utilisateurs</h2>
          <div class="row" style="gap:1.5rem">
            @for (r of rolesList(); track r.k) { <div><span class="xs muted">{{ r.nom }}</span><div class="price">{{ r.n }}</div></div> }
          </div>
        </div>
      } @else { <div class="empty"><span class="pulse-dot"></span></div> }
    }

    @if (tab() === 'verifs') {
      <div class="row" style="margin-bottom:1rem">
        @for (f of filtres; track f.id) { <button class="btn btn--sm" [class]="verifFiltre() === f.id ? 'btn btn--ink btn--sm' : 'btn btn--outline btn--sm'" (click)="setFiltre(f.id)">{{ f.nom }}</button> }
      </div>
      <div class="card">
        @for (p of profiles(); track p.id) {
          <div class="list-item">
            <div class="stack" style="--gap:.3rem">
              <strong>{{ p.prenom }} {{ p.nom }}</strong>
              <span class="small muted">{{ roleLabel(p.role) }} · {{ p.telephone || 'pas de téléphone' }} · inscrit le {{ p.created_at | date: 'd MMM y' }}</span>
              <div class="row" style="gap:.5rem">
                @if (p.cni_url) { <button class="btn btn--outline btn--sm" (click)="view(p.cni_url)"><i class="bi bi-person-vcard"></i> CNI / passeport</button> } @else { <span class="tag tag--off">pas de CNI</span> }
                @if (p.role === 'chauffeur') {
                  @if (p.permis_url) { <button class="btn btn--outline btn--sm" (click)="view(p.permis_url)"><i class="bi bi-card-heading"></i> Permis</button> } @else { <span class="tag tag--off">pas de permis</span> }
                }
              </div>
            </div>
            <div class="row">
              @if (p.statut_verif !== 'verifie') { <button class="btn btn--teal btn--sm" (click)="verify(p, 'verifie')" [disabled]="busy() === p.id"><i class="bi bi-check2"></i> Valider</button> }
              @if (p.statut_verif !== 'rejete') { <button class="btn btn--danger btn--sm" (click)="verify(p, 'rejete')" [disabled]="busy() === p.id">Refuser</button> }
            </div>
          </div>
        } @empty { <div class="empty"><i class="bi bi-inbox"></i><p>Aucun compte dans cette catégorie.</p></div> }
      </div>
    }

    @if (tab() === 'commerces') {
      <div class="card">
        @for (m of merchants(); track m.id) {
          <div class="list-item">
            <div><strong>{{ m.nom_commerce }}</strong> <span class="tag tag--go">{{ m.type }}</span>
              <div class="small muted">Gérant : {{ m.owner?.prenom }} {{ m.owner?.nom }} · {{ m.owner?.telephone || '—' }}</div></div>
            <div class="row">
              <span [class]="m.statut_verif === 'verifie' ? 'tag tag--ok' : m.statut_verif === 'rejete' ? 'tag tag--bad' : 'tag tag--wait'">{{ m.statut_verif }}</span>
              @if (m.statut_verif !== 'verifie') { <button class="btn btn--teal btn--sm" (click)="verifyMerchant(m, 'verifie')" [disabled]="busy() === m.id">Valider</button> }
              @if (m.statut_verif !== 'rejete') { <button class="btn btn--danger btn--sm" (click)="verifyMerchant(m, 'rejete')" [disabled]="busy() === m.id">Refuser</button> }
            </div>
          </div>
        } @empty { <div class="empty"><i class="bi bi-shop"></i><p>Aucun commerce enregistré.</p></div> }
      </div>
    }

    @if (tab() === 'dettes') {
      <div class="card">
        <div class="row row--between" style="margin-bottom:1rem"><h2 class="mb-0">Commissions impayées</h2><strong>Total : {{ fcfa(totalDettes()) }}</strong></div>
        <p class="small muted">Marquez une dette comme réglée une fois le virement Wave / Orange Money reçu. Le chauffeur est débloqué automatiquement.</p>
        @for (d of ledger(); track d.id) {
          <div class="list-item">
            <div><strong>{{ d.driver?.prenom }} {{ d.driver?.nom }}</strong><div class="small muted">{{ d.driver?.telephone || '—' }} · depuis le {{ d.created_at | date: 'd MMM y, HH:mm' }}</div></div>
            <div class="row"><span class="price">{{ fcfa(d.montant) }}</span>
              <button class="btn btn--teal btn--sm" (click)="settle(d)" [disabled]="busy() === d.id">Marquer réglée</button></div>
          </div>
        } @empty { <div class="empty"><i class="bi bi-check2-circle"></i><p>Aucune dette en cours.</p></div> }
      </div>
    }

    @if (tab() === 'dettes' && suspendus().length) {
      <div class="card mt-2">
        <h2>Comptes suspendus</h2>
        @for (p of suspendus(); track p.id) {
          <div class="list-item">
            <div><strong>{{ p.prenom }} {{ p.nom }}</strong> <span class="tag tag--bad">suspendu jusqu'au {{ p.suspendu_jusqua | date: 'd MMM, HH:mm' }}</span>
              <div class="small muted">{{ roleLabel(p.role) }} · {{ p.telephone || '—' }}</div></div>
            <button class="btn btn--outline btn--sm" (click)="lever(p)" [disabled]="busy() === p.id">Lever la suspension</button>
          </div>
        }
      </div>
    }

    @if (tab() === 'versements') {
      <div class="card">
        <h2>Soldes à reverser</h2>
        <p class="small muted">Les paiements Wave / Orange Money sont encaissés par la plateforme. Envoyez le net (après 5 % de commission) au bénéficiaire depuis votre compte marchand, puis enregistrez ici le versement avec sa référence : son solde diminue et il est notifié.</p>
        @for (b of soldes(); track b.beneficiaire_id) {
          <div class="list-item" style="align-items:flex-end">
            <div style="min-width:220px"><strong>{{ b.prenom }} {{ b.nom }}</strong> <span class="tag tag--go">{{ roleLabel(b.role) }}</span>
              <div class="small muted">{{ b.telephone || 'pas de téléphone' }}</div>
              <div class="price" style="font-size:1.3rem">{{ fcfa(b.a_verser) }}</div></div>
            <div class="row" style="align-items:flex-end;flex:1;justify-content:flex-end">
              <div class="field" style="width:120px"><label [attr.for]="'vm' + b.beneficiaire_id">Montant</label>
                <input [id]="'vm' + b.beneficiaire_id" type="number" min="1" [max]="b.a_verser" [ngModel]="montantV(b)" (ngModelChange)="vMontant[b.beneficiaire_id] = +$event" [ngModelOptions]="{standalone: true}"></div>
              <div class="field" style="width:140px"><label [attr.for]="'vy' + b.beneficiaire_id">Moyen</label>
                <select [id]="'vy' + b.beneficiaire_id" [ngModel]="vMoyen[b.beneficiaire_id] || 'wave'" (ngModelChange)="vMoyen[b.beneficiaire_id] = $event" [ngModelOptions]="{standalone: true}"><option value="wave">Wave</option><option value="orange_money">Orange Money</option></select></div>
              <div class="field" style="width:170px"><label [attr.for]="'vr' + b.beneficiaire_id">Référence du virement</label>
                <input [id]="'vr' + b.beneficiaire_id" [ngModel]="vRef[b.beneficiaire_id] || ''" (ngModelChange)="vRef[b.beneficiaire_id] = $event" [ngModelOptions]="{standalone: true}" placeholder="N° de transaction"></div>
              <button class="btn btn--teal btn--sm" (click)="verser(b)" [disabled]="busy() === b.beneficiaire_id">Enregistrer le versement</button>
            </div>
          </div>
        } @empty { <div class="empty"><i class="bi bi-check2-circle"></i><p>Aucun solde à reverser.</p></div> }
      </div>
    }

    @if (tab() === 'reglages') {
      <div class="stack stack--lg">
        <div class="card">
          <h2>Tarifs au kilomètre</h2>
          @for (p of pricing(); track p.id) {
            <div class="row" style="align-items:flex-end;margin-bottom:.8rem">
              <strong style="min-width:90px">{{ cat(p.categorie) }}</strong>
              <div class="field" style="width:110px"><label [attr.for]="'mn' + p.id">Min</label><input [id]="'mn' + p.id" type="number" [ngModel]="p.tarif_km_min" (ngModelChange)="p.tarif_km_min = +$event" [ngModelOptions]="{standalone: true}"></div>
              <div class="field" style="width:110px"><label [attr.for]="'bs' + p.id">Base</label><input [id]="'bs' + p.id" type="number" [ngModel]="p.tarif_km_base" (ngModelChange)="p.tarif_km_base = +$event" [ngModelOptions]="{standalone: true}"></div>
              <div class="field" style="width:110px"><label [attr.for]="'mx' + p.id">Max</label><input [id]="'mx' + p.id" type="number" [ngModel]="p.tarif_km_max" (ngModelChange)="p.tarif_km_max = +$event" [ngModelOptions]="{standalone: true}"></div>
              <button class="btn btn--ink btn--sm" (click)="savePricing(p)" [disabled]="busy() === p.id">Enregistrer</button>
            </div>
          }
        </div>
        <div class="card">
          <h2>Paramètres de la plateforme</h2>
          @for (c of config(); track c.cle) {
            <div class="list-item" style="align-items:center">
              <div style="flex:1;min-width:220px"><code style="font-size:.85rem">{{ c.cle }}</code><div class="xs muted">{{ c.description }}</div></div>
              <div class="row" style="flex-wrap:nowrap">
                <input class="cfg" [ngModel]="c.valeur" (ngModelChange)="c.valeur = $event" [ngModelOptions]="{standalone: true}" [attr.aria-label]="c.cle">
                <button class="btn btn--outline btn--sm" (click)="saveConfig(c)" [disabled]="busy() === c.cle">OK</button>
              </div>
            </div>
          }
        </div>
      </div>
    }
  </div>
</section>
  `,
  styles: [`.cfg { padding: .55em .8em; border: 1.5px solid var(--color-paper-line); border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); width: 140px; background: var(--color-white); }`],
})
export class AdminComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly tabs: { id: Tab; nom: string }[] = [
    { id: 'stats', nom: 'Statistiques' }, { id: 'verifs', nom: 'Vérifications' }, { id: 'commerces', nom: 'Commerces' },
    { id: 'dettes', nom: 'Commissions' }, { id: 'versements', nom: 'Versements' }, { id: 'reglages', nom: 'Réglages' },
  ];
  readonly filtres = [{ id: 'en_attente', nom: 'À examiner' }, { id: 'verifie', nom: 'Vérifiés' }, { id: 'rejete', nom: 'Refusés' }] as const;

  readonly tab = signal<Tab>('stats');
  readonly busy = signal<string | null>(null);
  readonly stats = signal<AdminStats | null>(null);
  readonly profiles = signal<Profile[]>([]);
  readonly verifFiltre = signal<'en_attente' | 'verifie' | 'rejete'>('en_attente');
  readonly merchants = signal<MerchantWithOwner[]>([]);
  readonly ledger = signal<LedgerWithDriver[]>([]);
  readonly soldes = signal<SoldeARerser[]>([]);
  readonly suspendus = signal<Profile[]>([]);
  vMontant: Record<string, number> = {};
  vMoyen: Record<string, 'wave' | 'orange_money'> = {};
  vRef: Record<string, string> = {};
  readonly pricing = signal<PricingConfig[]>([]);
  readonly config = signal<{ cle: string; valeur: string; description: string | null }[]>([]);

  readonly totalDettes = computed(() => this.ledger().reduce((s, d) => s + Number(d.montant), 0));
  readonly rolesList = computed(() => Object.entries(this.stats()?.utilisateurs ?? {}).map(([k, n]) => ({ k, nom: ROLES[k] ?? k, n })));

  constructor(private svc: AdminService, private toast: ToastService) {}

  ngOnInit() { this.open('stats'); }

  badge(t: Tab): number | null {
    const s = this.stats();
    if (!s) return null;
    const n = t === 'verifs' ? s.verifications_en_attente : t === 'commerces' ? s.commerces_en_attente : t === 'dettes' ? s.chauffeurs_bloques + s.comptes_suspendus : t === 'versements' ? (s.a_verser_total > 0 ? 1 : 0) : 0;
    return n > 0 ? n : null;
  }

  roleLabel(r: string) { return ROLES[r] ?? r; }
  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }

  async open(t: Tab) {
    this.tab.set(t);
    try {
      if (t === 'stats' || !this.stats()) this.stats.set(await this.svc.stats());
      if (t === 'verifs') this.profiles.set(await this.svc.profilesToReview(this.verifFiltre()));
      if (t === 'commerces') this.merchants.set(await this.svc.merchants());
      if (t === 'dettes') { this.ledger.set(await this.svc.ledger()); this.suspendus.set(await this.svc.suspendus()); }
      if (t === 'versements') this.soldes.set(await this.svc.soldes());
      if (t === 'reglages') { const [p, c] = await Promise.all([this.svc.pricing(), this.svc.config()]); this.pricing.set(p); this.config.set(c); }
    } catch (e) { this.toast.error(messageErreur(e)); }
  }

  async setFiltre(f: 'en_attente' | 'verifie' | 'rejete') { this.verifFiltre.set(f); await this.open('verifs'); }

  private async act(id: string, fn: () => Promise<unknown>, ok: string, reload: Tab) {
    this.busy.set(id);
    try { await fn(); this.toast.ok(ok); this.stats.set(await this.svc.stats()); await this.open(reload); }
    catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); }
  }

  verify(p: Profile, s: 'verifie' | 'rejete') { return this.act(p.id, () => this.svc.setVerification(p.id, s), s === 'verifie' ? 'Compte vérifié.' : 'Compte refusé.', 'verifs'); }
  verifyMerchant(m: MerchantWithOwner, s: 'verifie' | 'rejete') { return this.act(m.id, () => this.svc.setMerchantVerification(m.id, s), 'Commerce mis à jour.', 'commerces'); }
  montantV(b: SoldeARerser) { return this.vMontant[b.beneficiaire_id] ?? Math.floor(b.a_verser); }
  verser(b: SoldeARerser) {
    const m = this.montantV(b);
    return this.act(b.beneficiaire_id, () => this.svc.enregistrerVersement(b.beneficiaire_id, m, this.vMoyen[b.beneficiaire_id] || 'wave', this.vRef[b.beneficiaire_id]?.trim() || null, null),
      'Versement enregistré : le bénéficiaire est notifié.', 'versements');
  }
  lever(p: Profile) { return this.act(p.id, () => this.svc.leverSuspension(p.id), 'Suspension levée.', 'dettes'); }
  settle(d: LedgerWithDriver) { return this.act(d.id, () => this.svc.settleDebt(d.id), 'Dette réglée : le chauffeur est débloqué.', 'dettes'); }
  savePricing(p: PricingConfig) { return this.act(p.id, () => this.svc.setPricing(p.categorie, p.tarif_km_min, p.tarif_km_max, p.tarif_km_base), 'Tarif enregistré.', 'reglages'); }
  saveConfig(c: { cle: string; valeur: string }) { return this.act(c.cle, () => this.svc.setConfig(c.cle, c.valeur), 'Paramètre enregistré.', 'reglages'); }

  async view(path: string) {
    const url = await this.svc.signedDocument(path);
    if (url) window.open(url, '_blank', 'noopener'); else this.toast.error('Impossible d’ouvrir le document.');
  }
}
