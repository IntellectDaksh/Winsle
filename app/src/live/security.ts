// Detects secrets, tokens, and private keys to prevent credential leakage.

export const SECRET_PREFIXES = [
  "sk-",         // OpenAI, Anthropic, Stripe secret keys
  "ghp_",        // GitHub personal access token (legacy)
  "github_pat_", // GitHub fine-grained personal access token
  "gho_",        // GitHub OAuth access token
  "ghu_",        // GitHub user-to-server token
  "ghs_",        // GitHub server-to-server token
  "glpat-",      // GitLab personal access token
  "xoxb-",       // Slack bot token
  "xoxp-",       // Slack user token
  "xapp-",       // Slack app-level token
  "AKIA",        // AWS access key ID
  "AIza",        // Google API key
  "eyJ",         // JSON Web Token (JWT) header (base64 of {"...)
] as const;

export const PRIVATE_KEY_HEADER = "-----BEGIN";

/**
 * Checks if a string matches known API keys, tokens, JWTs, or private key blocks.
 */
export function isSecretText(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;

  // Private key blocks (PEM format)
  if (text.startsWith(PRIVATE_KEY_HEADER) && text.includes("PRIVATE KEY-----")) {
    return true;
  }

  // Known secret token prefixes
  for (const prefix of SECRET_PREFIXES) {
    if (text.startsWith(prefix)) {
      return true;
    }
  }

  // High-entropy token heuristic: single whitespace-free token with mixed characters, length >= 20
  // Catches API hashes, hex secrets, base64 tokens
  if (
    !/\s/.test(text) &&
    text.length >= 20 &&
    /[a-zA-Z]/.test(text) &&
    /[0-9]/.test(text)
  ) {
    return true;
  }

  return false;
}

/**
 * Masks a secret string for safe logging/display.
 * e.g., "sk-proj-1234567890abcdef" -> "sk-pro...cdef"
 */
export function maskSecret(secret: string): string {
  const text = secret.trim();
  if (text.length <= 8) {
    return "•".repeat(Math.max(4, text.length));
  }
  const head = text.slice(0, 6);
  const tail = text.slice(-4);
  return `${head}...${tail}`;
}
