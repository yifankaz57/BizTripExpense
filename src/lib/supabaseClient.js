import { createClient } from "@supabase/supabase-js";

// Supabaseプロジェクトの URL / Anon Key は .env ファイル（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）
// または GitHub Actions の Secrets から注入されます。ソースコードに直接キーは書きません。
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Supabaseの接続情報が設定されていません。.env（ローカル）または GitHub Secrets（デプロイ時）に " +
      "VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を設定してください。"
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");
