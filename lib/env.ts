/**
 * Coordonnées Supabase du CRM.
 * La clé « anon » est publique par conception : toute la sécurité repose sur
 * la RLS côté base (voir supabase/migrations/002_rls.sql).
 * Les variables d'environnement Vercel prennent le pas si elles sont définies.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://wyqgbihwkfvzxlzoxvvf.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cWdiaWh3a2Z2enhsem94dnZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1NjM2MDcsImV4cCI6MjA5NjEzOTYwN30.crERsQ4jHRS3WiRhPiPMGznRPMoZSOFiQtSlTjqh8Y4";
