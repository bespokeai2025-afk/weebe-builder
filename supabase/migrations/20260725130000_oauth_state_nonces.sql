-- One-time-use OAuth state nonces (replay protection for server OAuth callbacks).
-- Server-role only: consumed by inserting the nonce; a duplicate insert (23505)
-- means the state was already used and the callback must reject it.
CREATE TABLE IF NOT EXISTS public.oauth_state_nonces (
  nonce      text PRIMARY KEY,
  purpose    text NOT NULL DEFAULT 'gsc',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oauth_state_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_state_nonces FROM authenticated, anon;
