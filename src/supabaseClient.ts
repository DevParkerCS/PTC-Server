import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY"
  );
}

// ✅ Server-only admin client (bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

// ✅ Per-request user client (RLS enforced)
export const supabaseAsUser = (accessToken: string) =>
  createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

// Helper to extract Bearer token
export const getBearerToken = (authHeader?: string) => {
  if (!authHeader) return null;
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
};
