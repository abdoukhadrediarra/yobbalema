import { Injectable, signal } from '@angular/core';
import { createClient, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Profile } from '../models/models';

/**
 * Point d'entrée unique vers Supabase (Auth + PostgREST + Realtime + Storage).
 * Tous les autres services (trips, ride-requests, ...) passent par le client
 * exposé ici plutôt que d'en instancier un nouveau.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;

  /** Utilisateur Supabase Auth courant (null si non connecté). */
  readonly currentUser = signal<User | null>(null);
  /** Profil métier (table profiles) associé à l'utilisateur courant. */
  readonly currentProfile = signal<Profile | null>(null);
  /** true tant que la session initiale n'a pas été résolue. */
  readonly authReady = signal(false);

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });

    this.client.auth.getSession().then(({ data }) => {
      this.setSession(data.session);
      this.authReady.set(true);
    });

    this.client.auth.onAuthStateChange((_event, session) => {
      this.setSession(session);
    });
  }

  private async setSession(session: Session | null) {
    this.currentUser.set(session?.user ?? null);
    if (session?.user) {
      await this.refreshProfile(session.user.id);
    } else {
      this.currentProfile.set(null);
    }
  }

  async refreshProfile(userId: string) {
    const { data } = await this.client.from('profiles').select('*').eq('id', userId).maybeSingle();
    this.currentProfile.set((data as Profile) ?? null);
  }

  async signUp(params: {
    email: string;
    password: string;
    prenom: string;
    nom: string;
    telephone: string;
    role: string;
  }) {
    const { data, error } = await this.client.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: {
          prenom: params.prenom,
          nom: params.nom,
          telephone: params.telephone,
          role: params.role,
        },
      },
    });
    if (error) throw error;
    return data;
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async signOut() {
    await this.client.auth.signOut();
  }

  /** Envoie un e-mail de réinitialisation ; le lien ramène sur /nouveau-mot-de-passe. */
  async resetPassword(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    });
    if (error) throw error;
  }

  /** Change le mot de passe de l'utilisateur connecté (ou en session de récupération). */
  async updatePassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw error;
  }

  /** Demande l'envoi d'un code SMS pour vérifier un numéro (nécessite un fournisseur SMS configuré dans Supabase). */
  async requestPhoneOtp(phone: string) {
    const { error } = await this.client.auth.updateUser({ phone });
    if (error) throw error;
  }

  async verifyPhoneOtp(phone: string, token: string) {
    const { error } = await this.client.auth.verifyOtp({ phone, token, type: 'phone_change' });
    if (error) throw error;
  }

  /** Identifiant de l'utilisateur connecté (null si déconnecté). */
  get uid(): string | null {
    return this.currentUser()?.id ?? null;
  }

  /** Appelle une fonction SQL (supabase.rpc) et lève l'erreur Postgres telle quelle. */
  async rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args ?? {});
    if (error) throw error;
    return data as T;
  }

  /**
   * Écoute les changements d'une table (Supabase Realtime). Les règles RLS
   * s'appliquent : on ne reçoit que les lignes que l'utilisateur a le droit de voir.
   * Renvoie la fonction d'arrêt de l'écoute.
   */
  watch(table: string, filter: string | undefined, onChange: () => void): () => void {
    const name = `w_${table}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = this.client
      .channel(name)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => onChange()
      )
      .subscribe();
    return () => {
      this.client.removeChannel(channel);
    };
  }
}
