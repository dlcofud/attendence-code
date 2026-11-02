// Supabase 연결 정보
// anon(publishable) 키는 브라우저에 공개돼도 되는 키예요. 실제 보호는 schema.sql 의 RLS·RPC 가 담당합니다.
// service_role(secret) 키는 절대 여기에 넣지 마세요.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://vtunhdccplzhtqglfqhi.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
};
