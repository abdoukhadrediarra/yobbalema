import { Component, Input, OnChanges, OnDestroy, OnInit, signal } from '@angular/core';
import { Payment } from '../../core/models/models';
import { Fournisseur, PaymentsConfig, PaymentsService, Source } from '../../core/services/payments.service';
import { ToastService } from '../../core/services/toast.service';
import { fcfa, messageErreur } from '../../core/util/format';

/**
 * Affiche « À payer : X FCFA » avec les boutons Wave / Orange Money quand il reste un paiement
 * en ligne à régler pour cette course / ce trajet / cette livraison. Ne montre rien sinon
 * (déjà payé, paiement en espèces, ou mode test où tout est simulé).
 */
@Component({
  selector: 'app-pay-buttons',
  standalone: true,
  template: `
    @if (due() > 0 && cfg() && !cfg()!.test) {
      <div class="pay">
        <div class="pay__head"><i class="bi bi-wallet2"></i>
          <div><strong>À payer : {{ fcfa(due()) }}</strong><span>Paiement sécurisé par votre opérateur mobile.</span></div></div>
        @if (cfg()!.fournisseurs.length) {
          <div class="pay__btns">
            @if (cfg()!.fournisseurs.includes('wave')) { <button type="button" class="btn btn--teal" (click)="pay('wave')" [disabled]="busy()">{{ busy() === 'wave' ? 'Ouverture…' : 'Payer avec Wave' }}</button> }
            @if (cfg()!.fournisseurs.includes('orange_money')) { <button type="button" class="btn btn--gold" (click)="pay('orange_money')" [disabled]="busy()">{{ busy() === 'orange_money' ? 'Ouverture…' : 'Payer avec Orange Money' }}</button> }
          </div>
        } @else { <p class="xs muted mb-0">Aucun moyen de paiement en ligne n'est disponible pour le moment.</p> }
      </div>
    }
  `,
  styles: [`
    .pay { display: flex; flex-direction: column; gap: .8rem; padding: 1rem 1.1rem; border-radius: var(--radius-md); background: rgba(240,169,60,.13); border: 1px solid rgba(240,169,60,.45); }
    .pay__head { display: flex; gap: .8rem; align-items: flex-start; } .pay__head i { font-size: 1.4rem; color: var(--color-gold-deep); }
    .pay__head div { display: flex; flex-direction: column; } .pay__head span { font-size: var(--text-xs); color: var(--color-text-soft); }
    .pay__btns { display: flex; flex-wrap: wrap; gap: .6rem; }
  `],
})
export class PayButtonsComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) source!: Source;
  @Input({ required: true }) sourceId!: string;

  readonly fcfa = fcfa;
  readonly due = signal(0);
  readonly cfg = signal<PaymentsConfig | null>(null);
  readonly busy = signal<Fournisseur | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private svc: PaymentsService, private toast: ToastService) {}

  async ngOnInit() {
    try { this.cfg.set(await this.svc.config()); } catch { return; }
    await this.load();
    // le webhook de l'opérateur peut confirmer à tout moment : on rafraîchit pour masquer le bouton une fois payé
    this.timer = setInterval(() => this.load(), 6000);
  }
  ngOnChanges() { if (this.cfg()) void this.load(); }
  ngOnDestroy() { clearInterval(this.timer); }

  private async load() {
    try {
      const p: Payment[] = await this.svc.pendingFor(this.source, this.sourceId);
      this.due.set(p.reduce((s, x) => s + Number(x.montant), 0));
    } catch { /* silencieux : réessai au prochain cycle */ }
  }

  async pay(provider: Fournisseur) {
    this.busy.set(provider);
    try {
      const url = await this.svc.pay(this.source, this.sourceId, provider);
      window.location.href = url;     // page de l'opérateur, dans le navigateur (pas dans une webview)
    } catch (e) {
      this.toast.error(messageErreur(e));
      this.busy.set(null);
    }
  }
}
