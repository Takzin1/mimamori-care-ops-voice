import { VoiceOpsService, situationProviderFromEnvironment } from "../src/voice/index.ts";
import {
  createAssemblyAiVoiceCareOpsDeployment,
} from "../src/deployment/index.ts";

declare const process: {
  env: Readonly<
    Record<
      string,
      string | undefined
    >
  >;
};

type Runtime = ReturnType<
  typeof createAssemblyAiVoiceCareOpsDeployment
>;

const runtimes =
  new Map<string, Runtime>();

function requiredEnv(
  name: string,
): string {
  const value =
    process.env[name]
      ?.trim();

  if (!value) {
    throw new Error(
      `Missing server environment variable: ${name}`,
    );
  }

  return value;
}

function previewRuntime(
  request: Request,
): Runtime {
  if (
    process.env.VERCEL_ENV ===
      "production"
  ) {
    throw new Error(
      "Voice Ops Vercel adapter is preview-only until production admission is configured",
    );
  }

  const origin =
    new URL(
      request.url,
    ).origin;

  const cached =
    runtimes.get(
      origin,
    );

  if (cached) {
    return cached;
  }

  const env = {
    CARE_OPS_ENVIRONMENT:
      "staging",
    SUPABASE_URL:
      requiredEnv(
        "SUPABASE_URL",
      ),
    SUPABASE_PUBLISHABLE_KEY:
      requiredEnv(
        "SUPABASE_PUBLISHABLE_KEY",
      ),
    SUPABASE_SECRET_KEY:
      process.env
        .SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY:
      process.env
        .SUPABASE_SERVICE_ROLE_KEY,
    CARE_OPS_CONSOLE_ORIGINS:
      origin,
    CARE_OPS_SLA_POLICIES_JSON:
      requiredEnv(
        "CARE_OPS_SLA_POLICIES_JSON",
      ),
    CARE_OPS_OUTBOUND_TIMEOUT_MS:
      process.env
        .CARE_OPS_OUTBOUND_TIMEOUT_MS,
    CARE_OPS_MAX_COMMAND_BODY_BYTES:
      process.env
        .CARE_OPS_MAX_COMMAND_BODY_BYTES,
  };

  const runtime =
    createAssemblyAiVoiceCareOpsDeployment({
      env,
      voiceOpsService: new VoiceOpsService({ situationProvider: situationProviderFromEnvironment(process.env) }),
      assemblyAiApiKey:
        requiredEnv(
          "ASSEMBLYAI_API_KEY",
        ),
      voiceIntegritySecret:
        requiredEnv(
          "CARE_OPS_VOICE_INTEGRITY_SECRET",
        ),
      admission: {
        admit() {
          return {
            allowed: true,
          };
        },
      },
      logger: {
        write(record) {
          console.log(
            JSON.stringify({
              ...record,
              deployment:
                "vercel-preview",
            }),
          );
        },
      },
    });

  runtimes.set(
    origin,
    runtime,
  );

  return runtime;
}

function originalRequest(
  request: Request,
): Request {
  const url =
    new URL(
      request.url,
    );

  const path =
    url.searchParams.get(
      "__care_ops_path",
    );

  if (path === null) {
    return request;
  }

  url.searchParams.delete(
    "__care_ops_path",
  );

  url.pathname =
    path
      ? `/api/care-ops/${path}`
      : "/api/care-ops";

  return new Request(
    url,
    request,
  );
}

function configError(
  error: unknown,
): Response {
  const detail =
    error instanceof Error
      ? error.message
      : "unknown preview configuration error";

  console.error(
    JSON.stringify({
      event:
        "preview_configuration_error",
      detail,
    }),
  );

  return new Response(
    JSON.stringify({
      error: {
        code:
          "PREVIEW_CONFIGURATION_ERROR",
        message:
          "Voice Ops preview configuration is unavailable",
      },
    }),
    {
      status: 503,
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

async function handle(
  request: Request,
): Promise<Response> {
  try {
    const normalized =
      originalRequest(
        request,
      );

    return await previewRuntime(
      normalized,
    ).handle(
      normalized,
    );
  } catch (error) {
    return configError(
      error,
    );
  }
}

export const GET =
  handle;
export const HEAD =
  handle;
export const POST =
  handle;
export const OPTIONS =
  handle;
