// Porté verbatim depuis src/index.js v1. Protection temporaire par secret
// partagé (ALYZIA_API_SECRET) en attendant une vraie étape d'authentification.
export function isAuthorizedPrepa(request, env) {
  const expected = String(env.ALYZIA_API_SECRET || "").trim();
  if (!expected) return false;

  const auth = String(request.headers.get("Authorization") || "").trim();
  if (!auth.startsWith("Bearer ")) return false;

  const supplied = auth.slice(7).trim();
  return supplied === expected;
}
