// Edge Function Supabase (Deno) : ouvre une session de paiement chez Wave / Orange Money.
// Déploiement : supabase functions deploy payments-checkout
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCheckout } from '../_shared/handlers.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve((req) =>
  handleCheckout(req, {
    env: (k) => Deno.env.get(k),
    fetch,
    now: () => Date.now(),
    userClient: (auth) => createClient(URL, Deno.env.get('SUPABASE_ANON_KEY')!, { ...opts, global: { headers: { Authorization: auth } } }),
    adminClient: () => createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, opts),
  }),
);
