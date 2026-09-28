import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Module {
  icon: string;
  titre: string;
  description: string;
  accent: 'gold' | 'rust' | 'teal' | 'ink';
}

interface Offre {
  nom: string;
  icon: string;
  tarif: string;
  description: string;
  points: string[];
  mise_en_avant?: boolean;
}

interface Etape {
  titre: string;
  description: string;
  icon: string;
}

/** Les trois temps de la petite mise en scène du waxalé dans le hero. */
type EtapeWaxale = 'proposition' | 'recherche' | 'accepte';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly etapeWaxale = signal<EtapeWaxale>('proposition');
  private intervalId?: ReturnType<typeof setInterval>;

  readonly modules: Module[] = [
    {
      icon: 'bi-signpost-split',
      titre: 'Trajets interurbains',
      description:
        'Un conducteur publie son trajet Dakar–Thiès, Kaolack ou Touba ; les passagers réservent leur place à l\'avance, au prix fixé par siège.',
      accent: 'ink',
    },
    {
      icon: 'bi-car-front',
      titre: 'Courses à la demande',
      description:
        'Standard, Confort ou Pro : une course en ville, tout de suite, avec un tarif affiché — ou votre propre prix grâce au waxalé.',
      accent: 'gold',
    },
    {
      icon: 'bi-bus-front',
      titre: 'Bus TATA en direct',
      description:
        'La position en temps réel des bus sur votre trajet, pour savoir quand sortir de chez vous. Gratuit, pour tous.',
      accent: 'teal',
    },
    {
      icon: 'bi-box-seam',
      titre: 'Livraison',
      description:
        'Colis, repas, pharmacie ou marché : un livreur proche de vous récupère et livre, où que vous soyez.',
      accent: 'rust',
    },
  ];

  readonly offres: Offre[] = [
    {
      nom: 'Standard',
      icon: 'bi-car-front',
      tarif: '150 FCFA/km',
      description: 'Le choix économique pour vos trajets du quotidien en ville.',
      points: ['Véhicules courants', 'Tarif le plus accessible', 'Idéal pour les courtes distances'],
    },
    {
      nom: 'Confort',
      icon: 'bi-car-front-fill',
      tarif: '175 FCFA/km',
      description: 'Plus d\'espace et de confort, pour les trajets qui comptent.',
      points: ['Véhicules récents et climatisés', 'Plus d\'espace à bord', 'Un service plus soigné'],
      mise_en_avant: true,
    },
    {
      nom: 'Pro',
      icon: 'bi-award',
      tarif: '200 FCFA/km',
      description: 'Des chauffeurs professionnels, pour vos déplacements exigeants.',
      points: ['Chauffeurs professionnels agréés', 'Ponctualité garantie', 'Pour les rendez-vous importants'],
    },
  ];

  readonly etapes: Etape[] = [
    {
      icon: 'bi-phone',
      titre: 'Indiquez votre trajet',
      description: 'Point de départ, destination, et le service qu\'il vous faut : trajet longue distance ou course en ville.',
    },
    {
      icon: 'bi-cash-coin',
      titre: 'Acceptez le prix ou proposez le vôtre',
      description: 'Le tarif de base s\'affiche immédiatement. Vous pouvez aussi faire une offre : c\'est le waxalé.',
    },
    {
      icon: 'bi-broadcast',
      titre: 'Un chauffeur proche valide',
      description: 'Votre demande est envoyée aux chauffeurs disponibles autour de vous. Le plus proche peut l\'accepter.',
    },
    {
      icon: 'bi-flag',
      titre: 'Voyagez, livrez, arrivez',
      description: 'Suivez votre chauffeur en direct et payez par Wave, Orange Money ou en espèces.',
    },
  ];

  ngOnInit() {
    const sequence: EtapeWaxale[] = ['proposition', 'recherche', 'accepte'];
    let i = 0;
    this.intervalId = setInterval(() => {
      i = (i + 1) % sequence.length;
      this.etapeWaxale.set(sequence[i]);
    }, 2600);
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
