export type SupabaseServerCredential =
  | {
      kind: "secret";
      apiKey: string;
    }
  | {
      kind: "legacy-service-role";
      apiKey: string;
      authorization: string;
    };

export interface SupabaseServerCredentialInput {
  secretKey?: string;
  serviceRoleKey?: string;
}

function optionalText(
  value: string | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function createSupabaseServerCredential(
  input: SupabaseServerCredentialInput,
): SupabaseServerCredential {
  const secretKey = optionalText(input.secretKey);

  if (secretKey) {
    if (!secretKey.startsWith("sb_secret_")) {
      throw new Error(
        "Supabase secret key must use the sb_secret_ format",
      );
    }

    return {
      kind: "secret",
      apiKey: secretKey,
    };
  }

  const serviceRoleKey =
    optionalText(input.serviceRoleKey);

  if (!serviceRoleKey) {
    throw new Error(
      "Supabase server credential is required",
    );
  }

  if (serviceRoleKey.startsWith("sb_secret_")) {
    throw new Error(
      "sb_secret_ credentials must be provided as a Supabase secret key",
    );
  }

  return {
    kind: "legacy-service-role",
    apiKey: serviceRoleKey,
    authorization:
      `Bearer ${serviceRoleKey}`,
  };
}

export function supabaseServerHeaders(
  credential: SupabaseServerCredential,
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  headers.set("apikey", credential.apiKey);

  if (
    credential.kind ===
    "legacy-service-role"
  ) {
    headers.set(
      "authorization",
      credential.authorization,
    );
  } else {
    headers.delete("authorization");
  }

  return headers;
}
