import test from "node:test";
import assert from "node:assert/strict";

import {
  previewHealth,
} from "../api/health.ts";

const keys = [
  "ASSEMBLYAI_API_KEY",
  "CARE_OPS_VOICE_INTEGRITY_SECRET",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CARE_OPS_SLA_POLICIES_JSON",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

function restore(
  snapshot:
    Record<string, string | undefined>,
): void {
  for (const key of keys) {
    const value =
      snapshot[key];

    if (
      value === undefined
    ) {
      delete process.env[key];
    } else {
      process.env[key] =
        value;
    }
  }
}

function snapshotEnvironment():
  Record<string, string | undefined> {
  return Object.fromEntries(
    keys.map(
      (key) => [
        key,
        process.env[key],
      ],
    ),
  ) as Record<
    string,
    string | undefined
  >;
}

function configurePreview(): void {
  process.env.VERCEL_ENV =
    "preview";
  process.env.VERCEL_GIT_COMMIT_SHA =
    "1234567890abcdef";
  process.env.ASSEMBLYAI_API_KEY =
    "assembly-secret";
  process.env.CARE_OPS_VOICE_INTEGRITY_SECRET =
    "voice-integrity-test-secret-0123456789";
  process.env.SUPABASE_URL =
    "https://project.supabase.test";
  process.env.SUPABASE_PUBLISHABLE_KEY =
    "publishable";
  process.env.SUPABASE_SECRET_KEY =
    "sb_secret_test";
  delete process.env
    .SUPABASE_SERVICE_ROLE_KEY;
  process.env.CARE_OPS_SLA_POLICIES_JSON =
    "{}";
}

test("Vercel Preview health reports configured only when all server configuration is present", async () => {
  const snapshot =
    snapshotEnvironment();

  try {
    configurePreview();

    const response =
      previewHealth();

    assert.equal(
      response.status,
      200,
    );

    const body =
      await response.json() as {
        configured: boolean;
        mode: string;
        configuration: string;
        scope: string;
        missing: string[];
        commit: string | null;
      };

    assert.deepEqual(
      body,
      {
        configured: true,
        mode: "preview",
        configuration:
          "present",
        scope:
          "configuration-only",
        missing: [],
        situationUnderstanding: { provider: "rule_based", bedrockConfigurationPresent: false },
        commit:
          "1234567890ab",
      },
    );
  } finally {
    restore(snapshot);
  }
});

test("Vercel Preview health names missing configuration without exposing values", async () => {
  const snapshot =
    snapshotEnvironment();

  try {
    configurePreview();
    delete process.env
      .ASSEMBLYAI_API_KEY;

    const response =
      previewHealth();

    assert.equal(
      response.status,
      503,
    );

    const body =
      await response.json() as {
        configured: boolean;
        mode: string;
        configuration: string;
        missing: string[];
      };

    assert.equal(
      body.configured,
      false,
    );
    assert.equal(
      body.configuration,
      "incomplete",
    );
    assert.deepEqual(
      body.missing,
      ["ASSEMBLYAI_API_KEY"],
    );
    assert.equal(
      JSON.stringify(body).includes(
        "assembly-secret",
      ),
      false,
    );
  } finally {
    restore(snapshot);
  }
});

test("Vercel Preview health reports the server credential requirement when neither credential exists", async () => {
  const snapshot =
    snapshotEnvironment();

  try {
    configurePreview();
    delete process.env
      .SUPABASE_SECRET_KEY;
    delete process.env
      .SUPABASE_SERVICE_ROLE_KEY;

    const response =
      previewHealth();

    assert.equal(
      response.status,
      503,
    );

    const body =
      await response.json() as {
        configured: boolean;
        missing: string[];
      };

    assert.equal(
      body.configured,
      false,
    );
    assert.deepEqual(
      body.missing,
      [
        "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
      ],
    );
  } finally {
    restore(snapshot);
  }
});

test("Vercel health never reports Production as Voice-configured", async () => {
  const snapshot =
    snapshotEnvironment();

  try {
    configurePreview();
    process.env.VERCEL_ENV =
      "production";

    const response =
      previewHealth();

    assert.equal(
      response.status,
      503,
    );

    const body =
      await response.json() as {
        configured: boolean;
        mode: string;
        missing: string[];
      };

    assert.equal(
      body.configured,
      false,
    );
    assert.equal(
      body.mode,
      "production-blocked",
    );
    assert.deepEqual(
      body.missing,
      [],
    );
  } finally {
    restore(snapshot);
  }
});
