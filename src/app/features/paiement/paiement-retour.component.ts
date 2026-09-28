import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PaymentIntent } from '../../core/models/models';
import { PaymentsService } from '../../core/services/payments.service';
import { fcfa } from '../../core/util/format';

/** Page d'arrivée après l'opérateur : on n'affiche « payé » que lorsque le serveur l'a confirmé. */
@Component({
  selector: 'app-paiement-retour',
  standalone: true,
  imports: [RouterLink],
  template: `
<section class="page">
  <div class="container" style="max-width:560px">
    <div class="card stack" style="text-align:center;align-items:center">
      @switch (statut()) {
        @case ('reussi') {
          <i class="bi bi-check-circle-fill" style="font-size:3rem;color:var(--color-teal)"></i>
          <h1 style="font-size:var(--text-xl)">Paiement confirmé</h1>
          @if (intent(); as i) { <p class="price">{{ fcfa(i.montant) }}</p> }
          <p class="muted">Merci ! Le bénéficiaire a été prévenu.</p>
        }
        @case ('echoue') {
          <i class="bi bi-x-circle-fill" style="font-size:3rem;color:var(--color-rust)"></i>
          <h1 style="font-size:var(--text-xl)">Paiement non abouti</h1>
          <p class="muted">Rien n'a été débité, ou le paiement a été annulé. Vous pouvez réessayer depuis votre course, trajet ou livraison.</p>
        }
        @case ('expire') {
          <i class="bi bi-clock-history" style="font-size:3rem;color:var(--color-text-soft)"></i>
          <h1 style="font-size:var(--text-xl)">Tentative expirée</h1>
          <p class="muted">Le délai est dépassé. Relancez le paiement.</p>
        }
        @default {
          <span class="pulse-dot" style="width:1.2rem;height:1.2rem"></span>
          <h1 style="font-size:var(--text-xl)">Confirmation en cours…</h1>
          <p class="muted">Nous attendons la confirmation de votre opérateur. Cela prend en général quelques secondes.
            @if (lent()) { <br><strong>C'est plus long que d'habitude.</strong> Si vous avez bien validé le paiement, il sera confirmé automatiquement : vous serez notifié. }</p>
        }
      }
      <a routerLink="/tableau-de-bord" class="btn btn--ink">Retour à mon espace</a>
    </div>
  </div>
</section>
  `,
})
export class PaiementRetourComponent implements OnInit, OnDestroy {
  readonly fcfa = fcfa;
  readonly statut = signal<PaymentIntent['statut'] | 'chargement'>('chargement');
  readonly intent = signal<PaymentIntent | null>(null);
  readonly lent = signal(false);
  private timer?: ReturnType<typeof setInterval>;
  private tries = 0;

  constructor(private route: ActivatedRoute, private svc: PaymentsService) {}

  ngOnInit() {
    const id = this.route.snapshot.queryParamMap.get('intent');
    if (!id) { this.statut.set('echoue'); return; }
    const tick = async () => {
      this.tries++;
      try {
        this.intent.set(await this.svc.intent(id));
        const st = await this.svc.status(id);      // interroge l'opérateur si le webhook tarde
        this.statut.set(st);
        if (['reussi', 'echoue', 'expire'].includes(st)) clearInterval(this.timer);
      } catch { /* on réessaie */ }
      if (this.tries > 10) this.lent.set(true);
      if (this.tries > 40) clearInterval(this.timer);
    };
    void tick();
    this.timer = setInterval(tick, 3000);
  }
  ngOnDestroy() { clearInterval(this.timer); }
}
