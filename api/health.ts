declare const process: {
  env: Readonly<
    Record<
      string,
      string | undefined
    >
  >;
};

const REQUIRED = [
  "ASSEMBLYAI_API_KEY",
  "CARE_OPS_VOICE_INTEGRITY_SECRET",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "CARE_OPS_SLA_POLICIES_JSON",
] as const;

const SERVER_CREDENTIALS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const SERVER_CREDENTIAL_REQUIREMENT =
  "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY";

function configured(
  name: string,
): boolean {
  return Boolean(
    process.env[name]
      ?.trim(),
  );
}

function missingConfiguration():
  readonly string[] {
  const missing: string[] = REQUIRED.filter(
    (name) => !configured(name),
  );

  if (process.env.CARE_OPS_SITUATION_PROVIDER === "bedrock") {
    for (const name of ["AWS_REGION", "CARE_OPS_BEDROCK_MODEL_ID", "AWS_BEARER_TOKEN_BEDROCK"]) {
      if (!configured(name)) missing.push(name);
    }
  }

  if (
    !SERVER_CREDENTIALS.some(
      configured,
    )
  ) {
    return [
      ...missing,
      SERVER_CREDENTIAL_REQUIREMENT,
    ];
  }

  return missing;
}

export function previewHealth():
  Response {
  const preview =
    process.env.VERCEL_ENV !==
      "production";
  const missing =
    preview
      ? missingConfiguration()
      : [];
  const configuredForPreview =
    preview &&
    missing.length === 0;

  return new Response(
    JSON.stringify({
      configured:
        configuredForPreview,
      mode:
        preview
          ? "preview"
          : "production-blocked",
      configuration:
        configuredForPreview
          ? "present"
          : "incomplete",
      scope:
        "configuration-only",
      missing,
      situationUnderstanding: preview ? {
        provider: process.env.CARE_OPS_SITUATION_PROVIDER === "bedrock" ? "bedrock" : "rule_based",
        bedrockConfigurationPresent: ["AWS_REGION", "CARE_OPS_BEDROCK_MODEL_ID", "AWS_BEARER_TOKEN_BEDROCK"].every(configured),
      } : null,
      commit:
        process.env
          .VERCEL_GIT_COMMIT_SHA
          ?.slice(0, 12) ??
        null,
    }),
    {
      status:
        configuredForPreview
          ? 200
          : 503,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store",
        "x-content-type-options":
          "nosniff",
        "referrer-policy":
          "no-referrer",
      },
    },
  );
}

export const GET =
  previewHealth;
export const HEAD =
  previewHealth;
