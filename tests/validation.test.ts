import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

/**
 * Pre-send chat readiness — exercises the main-process validator
 * against a real on-disk profile so we cover the integration with
 * getModelConfig/readEnv/expectedEnvKeyForModel without filesystem
 * mocking.
 *
 * Fail-open semantics: any *uncertain* state (unknown provider+URL,
 * exception thrown) must return `{ok: true}`. The only "block" case
 * is a known provider missing its expected env var.
 */

const TEST_DIR = join(tmpdir(), `hermes-test-validation-${Date.now()}`);

async function freshValidation(
  home: string,
): Promise<typeof import("../src/main/validation")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/validation");
}

function writeConfig(content: string): void {
  writeFileSync(join(TEST_DIR, "config.yaml"), content);
}

function writeEnv(content: string): void {
  writeFileSync(join(TEST_DIR, ".env"), content);
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("validateChatReadiness", () => {
  it("returns ok for auto provider (key check makes no sense)", async () => {
    writeConfig(["model:", "  provider: auto", "  default: ''", ""].join("\n"));
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("blocks when configured provider's API key is missing from .env", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    // .env exists but doesn't have OPENROUTER_API_KEY
    writeEnv("SOME_OTHER_KEY=irrelevant\n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MISSING_API_KEY");
    expect(r.expectedEnvKey).toBe("OPENROUTER_API_KEY");
    expect(r.fixLocation).toBe("providers");
  });

  it("allows when configured provider's API key is present", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    writeEnv("OPENROUTER_API_KEY=sk-or-test-12345\n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("treats whitespace-only key value as missing", async () => {
    writeConfig(
      [
        "model:",
        "  provider: deepseek",
        "  default: deepseek-chat",
        "  base_url: https://api.deepseek.com/v1",
        "",
      ].join("\n"),
    );
    writeEnv("DEEPSEEK_API_KEY=   \n");
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness().ok).toBe(false);
  });

  it("fails open for OAuth providers (codex, qwen-oauth, etc.)", async () => {
    writeConfig(
      [
        "model:",
        "  provider: openai-codex",
        "  default: gpt-5-codex",
        "",
      ].join("\n"),
    );
    // No env file at all
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for nous (gateway-side credentials)", async () => {
    writeConfig(
      ["model:", "  provider: nous", "  default: hermes-4", ""].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for localhost base_url even with no key", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://localhost:11434/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for 127.0.0.1 base_url", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: llama-3",
        "  base_url: http://127.0.0.1:1234/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("fails open for unknown provider + unknown URL (we can't decide which key to check)", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: gpt-5.5",
        "  base_url: https://www.arccodex.com/api/codex/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    expect(validateChatReadiness()).toEqual({ ok: true });
  });

  it("blocks for custom provider on a known commercial host with no key", async () => {
    writeConfig(
      [
        "model:",
        "  provider: custom",
        "  default: gpt-4",
        "  base_url: https://api.openai.com/v1",
        "",
      ].join("\n"),
    );
    const { validateChatReadiness } = await freshValidation(TEST_DIR);
    const r = validateChatReadiness();
    expect(r.ok).toBe(false);
    expect(r.expectedEnvKey).toBe("OPENAI_API_KEY");
  });
});
