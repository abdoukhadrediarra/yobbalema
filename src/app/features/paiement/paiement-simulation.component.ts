import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PaymentIntent } from '../../core/models/models';
import { PaymentsService } from '../../core/services/payments.service';
import { ToastService } from '../../core/services/toast.service';
import { fcfa, messageErreur } from '../../core/util/format';

/** Fausse page d'opérateur, utilisée uniquement quand les Edge Functions tournent en PAYMENTS_MODE=mock. */
@Component({
  selector: 'app-paiement-simulation',
  standalone: true,
  template: `
<section class="page">
  <div class="container" style="max-width:520px">
    <div class="card stack">
      <span class="tag tag--wait" style="align-self:flex-start"><i class="bi bi-cone-striped"></i> Simulation — aucun argent réel</span>
      <h1 style="font-size:var(--text-xl)">Paiement {{ intent()?.provider === 'orange_money' ? 'Orange Money' : 'Wave' }} (démo)</h1>
      @if (intent(); as i) { <div class="price price--lg">{{ fcfa(i.montant) }}</div> <p class="small muted mb-0">Référence {{ i.ref_courte }}</p> }
      <div class="row">
        <button class="btn btn--teal" (click)="go('mock_pay')" [disabled]="busy()"><i class="bi bi-check2"></i> Simuler un paiement réussi</button>
        <button class="btn btn--danger" (click)="go('mock_fail')" [disabled]="busy()">Simuler un échec</button>
      </div>
      <p class="xs muted mb-0">Cette page remplace celle de l'opérateur pour tester le parcours complet. Elle n'existe que si la fonction de paiement est en mode simulation.</p>
    </div>
  </div>
</section>
  `,
})
export class PaiementSimulationComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly intent = signal<PaymentIntent | null>(null);
  readonly busy = signal(false);
  private id = '';

  constructor(private route: ActivatedRoute, private svc: PaymentsService, private router: Router, private toast: ToastService) {}

  async ngOnInit() {
    this.id = this.route.snapshot.queryParamMap.get('intent') ?? '';
    this.intent.set(await this.svc.intent(this.id));
  }

  async go(action: 'mock_pay' | 'mock_fail') {
    this.busy.set(true);
    try {
      await this.svc.mock(this.id, action);
      this.router.navigate(['/paiement/retour'], { queryParams: { intent: this.id, statut: action === 'mock_pay' ? 'ok' : 'erreur' } });
    } catch (e) { this.toast.error(messageErreur(e)); this.busy.set(false); }
  }
}
