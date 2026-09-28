import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

const LIBELLES_ROLE: Record<string, string> = {
  client: 'Passager',
  chauffeur: 'Chauffeur',
  receveur_bus: 'Receveur de bus',
  commercant: 'Commerçant',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  constructor(public supabase: SupabaseService) {}

  readonly prenom = computed(() => this.supabase.currentProfile()?.prenom ?? '');
  readonly libelleRole = computed(() => {
    const role = this.supabase.currentProfile()?.role ?? 'client';
    return LIBELLES_ROLE[role] ?? role;
  });
  readonly suspendu = computed(() => { const j = this.supabase.currentProfile()?.suspendu_jusqua; return !!j && new Date(j).getTime() > Date.now(); });
  readonly suspenduJusqua = computed(() => { const j = this.supabase.currentProfile()?.suspendu_jusqua; return j ? new Date(j).toISOString().slice(0, 16).replace('T', ' à ') : ''; });
  readonly role = computed(() => this.supabase.currentProfile()?.role ?? 'client');
  readonly statutVerif = computed(() => this.supabase.currentProfile()?.statut_verif ?? 'en_attente');
}
