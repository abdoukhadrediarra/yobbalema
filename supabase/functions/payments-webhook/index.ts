// Edge Function Supabase (Deno) : reçoit les notifications de paiement de Wave / Orange Money.
// Déploiement SANS vérification JWT (l'opérateur n'envoie pas de jeton Supabase) :
//   supabase functions deploy payments-webhook --no-verify-jwt
// URL à déclarer chez l'opérateur :
//   https://<projet>.supabase.co/functions/v1/payments-webhook?p=wave
//   https://<projet>.supabase.co/functions/v1/payments-webhook?p=orange_money
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleWebhook } from '../_shared/handlers.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve((req) =>
  handleWebhook(req, {
    env: (k) => Deno.env.get(k),
    fetch,
    now: () => Date.now(),
    userClient: () => { throw new Error('non utilisé'); },
    adminClient: () => createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, opts),
  }),
);
