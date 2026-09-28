import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Pages Conditions d'utilisation, Confidentialité et Contact.
 * ATTENTION : les textes juridiques ci-dessous sont un MODÈLE DE DÉPART rédigé pour refléter le
 * fonctionnement réel de la plateforme. Ils doivent être relus et validés par un juriste avant
 * la mise en production (droit sénégalais, protection des données personnelles, statut de la société).
 */
@Component({
  selector: 'app-legal',
  standalone: true,
  imports: [RouterLink],
  template: `
<section class="page">
  <div class="container" style="max-width:780px">
    <div class="alert alert--warn" style="margin-bottom:1.5rem"><i class="bi bi-exclamation-triangle"></i><p><strong>Modèle à faire valider.</strong> Ce texte doit être relu par un juriste avant la mise en ligne publique.</p></div>

    @switch (page()) {
      @case ('conditions') {
        <h1>Conditions d'utilisation</h1>
        <div class="legal stack">
          <h2>1. Objet</h2>
          <p>Yobbalema met en relation des passagers, des chauffeurs, des receveurs de bus, des livreurs et des commerçants partenaires au Sénégal : trajets interurbains, courses à la demande, suivi des bus TATA et livraison. Yobbalema est un intermédiaire technique : le contrat de transport ou de vente est conclu entre les utilisateurs.</p>
          <h2>2. Comptes</h2>
          <p>Chaque personne crée un compte avec des informations exactes. Les chauffeurs, receveurs et commerçants peuvent être invités à faire vérifier leur identité (pièce d'identité, permis de conduire). Yobbalema peut suspendre un compte en cas de fraude, d'information fausse ou de comportement dangereux.</p>
          <h2>3. Prix, waxalé et commission</h2>
          <p>Le prix d'une course est calculé à partir d'un tarif au kilomètre. Le passager peut proposer son propre prix (« waxalé ») : le chauffeur voit l'offre avant de l'accepter et reste libre de la refuser. Yobbalema prélève une commission de 5 % sur ce que perçoit le chauffeur, le livreur ou le commerçant ; elle n'est jamais ajoutée au prix payé par le passager ou le client.</p>
          <h2>4. Paiement en espèces et commission due</h2>
          <p>Lorsqu'un paiement est encaissé en espèces, la commission correspondante est enregistrée comme une dette du chauffeur ou du livreur. Tant qu'une commission n'est pas réglée, le compte ne peut plus accepter de nouvelle course, livraison ou trajet.</p>
          <h2>5. Livraison avec devis</h2>
          <p>Pour une livraison auprès d'un commerçant partenaire, le commerçant établit un devis (prix de chaque article et prix de la livraison). Le client le valide avant toute livraison. Un devis non validé dans le délai indiqué expire. Le règlement d'une commande marchande se fait en ligne.</p>
          <h2>6. Annulations</h2>
          <p>Un passager peut annuler une course tant qu'elle n'a pas démarré. Un chauffeur peut se désister avant le départ : la course est alors proposée à d'autres chauffeurs. Des désistements ou annulations répétés peuvent conduire à une suspension.</p>
          <h2>7. Comportement</h2>
          <p>Les utilisateurs s'engagent à respecter la loi, le code de la route et les autres utilisateurs. Les avis doivent être honnêtes et respectueux.</p>
          <h2>8. Responsabilité</h2>
          <p>Yobbalema n'est pas partie au contrat de transport ou de vente et ne garantit pas la disponibilité continue du service ni l'exactitude de l'heure d'arrivée estimée des bus, qui est donnée à titre indicatif.</p>
          <h2>9. Contact</h2>
          <p>Pour toute question : voir la page <a routerLink="/contact">Contact</a>.</p>
        </div>
      }
      @case ('confidentialite') {
        <h1>Politique de confidentialité</h1>
        <div class="legal stack">
          <h2>Données collectées</h2>
          <p>Identité et coordonnées (nom, prénom, e-mail, téléphone) ; pièces d'identité et permis (chauffeurs, receveurs, commerçants) ; position géographique pendant l'usage (départ, arrivée, position du chauffeur pendant une mission, position du bus partagée par un receveur) ; historique des courses, livraisons, paiements et avis ; pour une commande de pharmacie, la photo de l'ordonnance.</p>
          <h2>Finalités</h2>
          <p>Fournir le service (mise en relation, calcul des prix, suivi en direct), vérifier les comptes, gérer les paiements et les commissions, prévenir la fraude, notifier les utilisateurs et améliorer la plateforme.</p>
          <h2>Qui voit quoi</h2>
          <p>Votre numéro de téléphone n'est visible que par les personnes avec qui vous partagez une course, une réservation ou une livraison. Vos pièces d'identité sont stockées de façon privée et ne sont consultables que par vous et l'équipe de vérification. Une ordonnance n'est visible que par la pharmacie qui traite votre commande. La position d'un chauffeur n'est visible que par son client pendant la mission. La position d'un bus est publique par nature et n'est jamais associée à une identité affichée.</p>
          <h2>Paiements</h2>
          <p>Yobbalema ne stocke aucune donnée bancaire ; seules les références de transaction fournies par les opérateurs de paiement mobile sont conservées.</p>
          <h2>Conservation et droits</h2>
          <p>Vous pouvez demander l'accès, la rectification ou la suppression de vos données en nous contactant. Les durées de conservation et les démarches auprès de l'autorité sénégalaise de protection des données personnelles sont à préciser avec votre conseil juridique.</p>
        </div>
      }
      @default {
        <h1>Contact</h1>
        <div class="legal stack">
          <p>Une question, un problème avec une course, un paiement ou votre compte ? Écrivez-nous.</p>
          <div class="card stack" style="--gap:.8rem">
            <a class="btn btn--outline" [href]="'mailto:' + email"><i class="bi bi-envelope"></i> {{ email }}</a>
            @if (phone) { <a class="btn btn--outline" [href]="'tel:' + phone.replace(' ', '')"><i class="bi bi-telephone"></i> {{ phone }}</a> }
            @if (whatsapp) { <a class="btn btn--teal" [href]="'https://wa.me/' + whatsapp.replace('+', '')" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> WhatsApp</a> }
          </div>
          <p class="small muted">Indiquez votre nom, votre adresse e-mail de connexion et, le cas échéant, la date et le lieu de la course concernée.</p>
        </div>
      }
    }
  </div>
</section>
  `,
  styles: [`.legal h2 { font-size: var(--text-lg); margin-top: 1.2rem; margin-bottom: .2rem; } .legal p { max-width: none; }`],
})
export class LegalComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, { initialValue: {} as Record<string, unknown> });
  readonly page = computed(() => (this.data()['page'] as string) ?? 'contact');
  private readonly env = environment as { supportEmail?: string; supportPhone?: string; supportWhatsapp?: string };
  readonly email = this.env.supportEmail ?? 'contact@yobbalema.sn';
  readonly phone = this.env.supportPhone ?? '';
  readonly whatsapp = this.env.supportWhatsapp ?? '';
}
