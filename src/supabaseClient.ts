import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vyfvtecaykkzuxvbftme.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_I6GaL0u763q48hnMAzcgtQ_2mlA5GaE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
