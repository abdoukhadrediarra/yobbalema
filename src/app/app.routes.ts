import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
    title: 'Yobbalema — Voyagez, livrez, avancez ensemble',
  },
  {
    path: 'connexion',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent),
    title: 'Connexion — Yobbalema',
  },
  {
    path: 'inscription',
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent),
    title: 'Créer un compte — Yobbalema',
  },
  {
    path: 'mot-de-passe-oublie',
    loadComponent: () => import('./features/auth/forgot-password.component').then((m) => m.ForgotPasswordComponent),
    title: 'Mot de passe oublié — Yobbalema',
  },
  {
    path: 'nouveau-mot-de-passe',
    loadComponent: () => import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
    title: 'Nouveau mot de passe — Yobbalema',
  },
  {
    path: 'conditions',
    loadComponent: () => import('./features/legal/legal.component').then((m) => m.LegalComponent),
    data: { page: 'conditions' },
    title: 'Conditions d’utilisation — Yobbalema',
  },
  {
    path: 'confidentialite',
    loadComponent: () => import('./features/legal/legal.component').then((m) => m.LegalComponent),
    data: { page: 'confidentialite' },
    title: 'Confidentialité — Yobbalema',
  },
  {
    path: 'contact',
    loadComponent: () => import('./features/legal/legal.component').then((m) => m.LegalComponent),
    data: { page: 'contact' },
    title: 'Contact — Yobbalema',
  },
  {
    path: 'paiement/retour',
    loadComponent: () => import('./features/paiement/paiement-retour.component').then((m) => m.PaiementRetourComponent),
    canActivate: [authGuard],
    title: 'Paiement — Yobbalema',
  },
  {
    path: 'paiement/simulation',
    loadComponent: () => import('./features/paiement/paiement-simulation.component').then((m) => m.PaiementSimulationComponent),
    canActivate: [authGuard],
    title: 'Paiement (simulation) — Yobbalema',
  },
  {
    path: 'historique',
    loadComponent: () => import('./features/historique/historique.component').then((m) => m.HistoriqueComponent),
    canActivate: [authGuard],
    title: 'Historique — Yobbalema',
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [adminGuard],
    title: 'Administration — Yobbalema',
  },
  {
    path: 'tableau-de-bord',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
    title: 'Mon espace — Yobbalema',
  },
  {
    path: 'profil',
    loadComponent: () => import('./features/profil/profil.component').then((m) => m.ProfilComponent),
    canActivate: [authGuard],
    title: 'Mon profil — Yobbalema',
  },

  // --- Trajets interurbains
  {
    path: 'trajets',
    loadComponent: () => import('./features/trajets/trajets.component').then((m) => m.TrajetsComponent),
    canActivate: [authGuard],
    title: 'Trajets interurbains — Yobbalema',
  },
  {
    path: 'trajets/publier',
    loadComponent: () => import('./features/trajets/trajet-publier.component').then((m) => m.TrajetPublierComponent),
    canActivate: [authGuard],
    title: 'Publier un trajet — Yobbalema',
  },
  {
    path: 'mes-trajets',
    loadComponent: () => import('./features/trajets/mes-trajets.component').then((m) => m.MesTrajetsComponent),
    canActivate: [authGuard],
    title: 'Mes trajets — Yobbalema',
  },

  // --- Courses à la demande
  {
    path: 'courses',
    loadComponent: () => import('./features/courses/courses.component').then((m) => m.CoursesComponent),
    canActivate: [authGuard],
    title: 'Course à la demande — Yobbalema',
  },

  // --- Espace chauffeur
  {
    path: 'chauffeur',
    loadComponent: () => import('./features/chauffeur/compte.component').then((m) => m.ChauffeurCompteComponent),
    canActivate: [authGuard],
    title: 'Espace chauffeur — Yobbalema',
  },
  {
    path: 'chauffeur/missions',
    loadComponent: () => import('./features/chauffeur/missions.component').then((m) => m.MissionsComponent),
    canActivate: [authGuard],
    title: 'Mode chauffeur — Yobbalema',
  },

  // --- Bus TATA (la consultation est publique et gratuite)
  {
    path: 'bus',
    loadComponent: () => import('./features/bus/bus.component').then((m) => m.BusComponent),
    title: 'Bus TATA en direct — Yobbalema',
  },
  {
    path: 'bus/receveur',
    loadComponent: () => import('./features/bus/bus-receveur.component').then((m) => m.BusReceveurComponent),
    canActivate: [authGuard],
    title: 'Espace receveur — Yobbalema',
  },

  // --- Livraison
  {
    path: 'livraisons',
    loadComponent: () => import('./features/livraisons/livraisons.component').then((m) => m.LivraisonsComponent),
    canActivate: [authGuard],
    title: 'Livraison — Yobbalema',
  },
  {
    path: 'commerce',
    loadComponent: () => import('./features/livraisons/commerce.component').then((m) => m.CommerceComponent),
    canActivate: [authGuard],
    title: 'Espace commerçant — Yobbalema',
  },

  { path: '**', redirectTo: '' },
];
