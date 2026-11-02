// core/api.js — Supabase 클라이언트와 RPC 호출

const cfg = window.APP_CONFIG || {};

export const isConfigured = Boolean(
  cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/YOUR_/.test(cfg.SUPABASE_ANON_KEY),
);
export const hasLib = Boolean(window.supabase && window.supabase.createClient);

export const sb = isConfigured && hasLib
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// 서버 함수 호출. 실패하면 서버가 보낸 한국어 메시지를 담은 Error 를 던짐.
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw new Error(error.message || String(error));
  return data;
}
