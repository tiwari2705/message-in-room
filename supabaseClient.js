const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    'Supabase is not fully configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your environment.',
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || '');

module.exports = { supabase };

