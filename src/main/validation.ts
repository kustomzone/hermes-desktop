/**
 * Pre-send chat readiness validation.
 *
 * Runs on the renderer's request (and on model/profile change) to
 * answer one question: if the user hits Send right now, will it work?
 *
 * Surfaces a structured reason + a "where to fix it" hint when it
 * won't, so the renderer can disable the Send button and show an
 * inline banner instead of letting the user fire off a request that
 * the gateway is about to 401 / 403 / "Configure API_SERVER_KEY" on.
 *
 * **Fail open**: any check that throws or hits an uncertain state
 * returns `{ok: true}`. The goal is to catch the obvious "model
 * configured but key missing" footgun without ever false-blocking
 * a Send. If we're not sure, allow the send and let the upstream
 * surface the error like before.
 */

import { getModelConfig, readEnv } from "./config";
import { expectedEnvKeyForModel } from "./installer";

export type ChatReadinessCode =
  | "NO_ACTIVE_MODEL"
  | "NO_PROVIDER"
  | "NO_BASE_URL"
  | "MISSING_API_KEY"
  | "GATEWAY_DOWN";

export type FixLocation = "providers" | "models" | "gateway" | "setup";

export interface ChatReadiness {
  ok: boolean;
  code?: ChatReadinessCode;
  /** Stable English message — the renderer maps to i18n by code. */
  message?: string;
  /** Where to send the user to resolve it. */
  fixLocation?: FixLocation;
  /** Env var name the user is expected to populate, if applicable. */
  expectedEnvKey?: string;
}

const OK: ChatReadiness = { ok: true };

// Provider ids that authenticate via interactive OAuth login rather
// than a static API key (`hermes auth add <id> --type oauth`). Their
// credential lives in a per-provider token cache that's harder to
// probe synchronously, so we skip the env-var check for them and
// fail open — the upstream error path still surfaces "not signed in"
// at send time on those.
const OAUTH_PROVIDERS = new Set([
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "google-gemini-cli",
  "minimax-oauth",
  "kimi-coding",
  "nous",
]);

// Provider ids that don't need an API key at all (Nous-hosted gateway,
// some local self-hosted setups when the server doesn't enforce auth).
const NO_KEY_PROVIDERS = new Set(["nous", "auto"]);

function isLocalHost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(
    url,
  );
}

/**
 * Synchronous readiness check against the desktop's own config —
 * no network calls. Fast (single readEnv + getModelConfig).
 *
 * `profile` defaults to the active profile.
 */
export function validateChatReadiness(profile?: string): ChatReadiness {
  try {
    const mc = getModelConfig(profile);
    const provider = (mc.provider || "").trim().toLowerCase();
    const model = (mc.model || "").trim();
    const baseUrl = (mc.baseUrl || "").trim();

    // Provider="auto" lets hermes-agent pick a model at runtime based
    // on whatever keys are present in .env. No key-presence check
    // makes sense for it — fail open.
    if (!provider || provider === "auto") return OK;

    if (!model && provider !== "auto") {
      return {
        ok: false,
        code: "NO_ACTIVE_MODEL",
        message: "No model selected. Pick one in Models or the Chat picker.",
        fixLocation: "models",
      };
    }

    if (OAUTH_PROVIDERS.has(provider) || NO_KEY_PROVIDERS.has(provider)) {
      // OAuth/no-key providers — skip the env-var check; the gateway's
      // own auth path surfaces "not signed in" at send time. Fail open.
      return OK;
    }

    // Local/private URLs typically don't require a key; the user may
    // intentionally hit an unauthenticated LM Studio / Ollama. Don't
    // block on missing key in that case.
    if (baseUrl && isLocalHost(baseUrl)) return OK;

    const expectedKey = expectedEnvKeyForModel(provider, baseUrl);
    if (!expectedKey) {
      // Unknown provider+URL combination. We don't know which env var
      // to check, so fail open rather than risk a false-positive
      // block.
      return OK;
    }

    const env = readEnv(profile);
    const value = (env[expectedKey] ?? "").trim();
    if (!value) {
      return {
        ok: false,
        code: "MISSING_API_KEY",
        message: `Missing ${expectedKey} for ${provider}. Set it in Providers.`,
        fixLocation: "providers",
        expectedEnvKey: expectedKey,
      };
    }

    return OK;
  } catch {
    // Fail open on any unexpected error — never false-block a Send.
    return OK;
  }
}
