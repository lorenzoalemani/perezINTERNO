import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Faltan variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Revisá tu archivo .env'
  );
}

// Nota: no se pasa el genérico `Database` porque todavía no generamos los tipos
// reales desde Supabase (`supabase gen types typescript`). Los tipos de dominio
// en src/types/database.ts se usan manualmente para tipar los resultados de cada
// query. Cuando el proyecto esté creado, se puede generar el esquema real y
// pasarlo aquí como createClient<Database>(...) para autocompletado completo.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
