import { Injectable } from '@angular/core';
import { PublicProfile } from '../models/models';
import { SupabaseService } from './supabase.service';

export interface RelatedProfile { id: string; prenom: string | null; nom: string | null; telephone: string | null; note_moyenne: number | null }

@Injectable({ providedIn: 'root' })
export class ProfileService {
  constructor(private sb: SupabaseService) {}

  async update(fields: { prenom?: string; nom?: string; telephone?: string }) {
    const { error } = await this.sb.client.from('profiles').update(fields).eq('id', this.sb.uid!);
    if (error) throw error;
    await this.sb.refreshProfile(this.sb.uid!);
  }

  /** Envoie une pièce dans le bucket privé « documents » et enregistre son chemin sur le profil. */
  async uploadDocument(kind: 'cni' | 'permis', file: File) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${this.sb.uid}/${kind}-${Date.now()}.${ext}`;
    const { error } = await this.sb.client.storage.from('documents').upload(path, file, { contentType: file.type, upsert: true });
    if (error) throw error;
    const column = kind === 'cni' ? 'cni_url' : 'permis_url';
    const { error: e2 } = await this.sb.client.from('profiles').update({ [column]: path }).eq('id', this.sb.uid!);
    if (e2) throw e2;
    await this.sb.refreshProfile(this.sb.uid!);
    return path;
  }

  /** Profil complet d'une personne « en relation » (course, réservation, livraison partagées). */
  async related(id: string): Promise<RelatedProfile | null> {
    const { data } = await this.sb.client.from('profiles').select('id, prenom, nom, telephone, note_moyenne').eq('id', id).maybeSingle();
    return (data as RelatedProfile) ?? null;
  }

  async publicProfile(id: string): Promise<PublicProfile | null> {
    const { data } = await this.sb.client.from('profils_publics').select('*').eq('id', id).maybeSingle();
    return (data as PublicProfile) ?? null;
  }
}
