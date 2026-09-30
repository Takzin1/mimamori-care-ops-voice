declare const process: {
  env: Readonly<
    Record<string, string | undefined>
  >;
};

const TENANT_ID =
  "tenant-demo";
const ACTOR_ID =
  "voice-preview-responder";

function json(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
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

function env(
  name: string,
): string {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `missing ${name}`,
    );
  }

  return value;
}

function httpsOrigin(
  value: string,
): string {
  const url =
    new URL(value);

  if (
    url.protocol !==
      "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (
      url.pathname &&
      url.pathname !== "/"
    )
  ) {
    throw new Error(
      "invalid Supabase origin",
    );
  }

  return url.origin;
}

function fail(
  stage: string,
  upstreamStatus:
    number,
): Response {
  console.error(
    JSON.stringify({
      event:
        "voice_preview_auth_failed",
      stage,
      upstreamStatus,
    }),
  );

  return json(
    502,
    {
      error: {
        code:
          "PREVIEW_AUTH_FAILED",
        message:
          "Preview authentication failed",
      },
    },
  );
}

function principalId(
  value: unknown,
): string | null {
  if (
    !Array.isArray(value) ||
    value.length !== 1
  ) {
    return null;
  }

  const row =
    value[0];

  if (
    !row ||
    typeof row !==
      "object" ||
    Array.isArray(row)
  ) {
    return null;
  }

  const id =
    (
      row as
        Record<
          string,
          unknown
        >
    ).principal_id;

  return typeof id ===
      "string" &&
    id.length > 0
    ? id
    : null;
}

async function handle(
  request: Request,
): Promise<Response> {
  if (
    process.env.VERCEL_ENV !==
      "preview"
  ) {
    return json(
      404,
      {
        error: {
          code:
            "NOT_FOUND",
          message:
            "Not found",
        },
      },
    );
  }

  const target =
    new URL(
      request.url,
    );
  const origin =
    request.headers.get(
      "origin",
    );

  if (
    request.method !==
      "POST"
  ) {
    return json(
      405,
      {
        error: {
          code:
            "METHOD_NOT_ALLOWED",
          message:
            "Method not allowed",
        },
      },
    );
  }

  if (
    !origin ||
    origin !==
      target.origin ||
    !target.hostname.endsWith(
      ".vercel.app",
    )
  ) {
    return json(
      403,
      {
        error: {
          code:
            "PREVIEW_ORIGIN_REQUIRED",
          message:
            "Protected Preview origin required",
        },
      },
    );
  }

  try {
    const supabaseUrl =
      httpsOrigin(
        env(
          "SUPABASE_URL",
        ),
      );
    const publishableKey =
      env(
        "SUPABASE_PUBLISHABLE_KEY",
      );
    const secretKey =
      env(
        "SUPABASE_SECRET_KEY",
      );

    if (
      !secretKey.startsWith(
        "sb_secret_",
      )
    ) {
      throw new Error(
        "modern Supabase secret key required",
      );
    }

    const membershipUrl =
      new URL(
        "/rest/v1/care_tenant_memberships",
        supabaseUrl,
      );

    membershipUrl
      .searchParams
      .set(
        "tenant_id",
        `eq.${TENANT_ID}`,
      );
    membershipUrl
      .searchParams
      .set(
        "actor_id",
        `eq.${ACTOR_ID}`,
      );
    membershipUrl
      .searchParams
      .set(
        "active",
        "eq.true",
      );
    membershipUrl
      .searchParams
      .set(
        "select",
        "principal_id",
      );
    membershipUrl
      .searchParams
      .set(
        "limit",
        "1",
      );

    const membershipResponse =
      await fetch(
        membershipUrl,
        {
          headers: {
            apikey:
              secretKey,
            accept:
              "application/json",
          },
          cache:
            "no-store",
          credentials:
            "omit",
          redirect:
            "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    if (
      !membershipResponse.ok
    ) {
      return fail(
        "membership_lookup",
        membershipResponse.status,
      );
    }

    const id =
      principalId(
        await membershipResponse
          .json(),
      );

    if (!id) {
      return fail(
        "membership_shape",
        500,
      );
    }

    const userResponse =
      await fetch(
        new URL(
          `/auth/v1/admin/users/${encodeURIComponent(
            id,
          )}`,
          supabaseUrl,
        ),
        {
          headers: {
            apikey:
              secretKey,
            accept:
              "application/json",
          },
          cache:
            "no-store",
          credentials:
            "omit",
          redirect:
            "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    if (
      !userResponse.ok
    ) {
      return fail(
        "user_lookup",
        userResponse.status,
      );
    }

    const user =
      await userResponse
        .json() as
        Record<
          string,
          unknown
        >;
    const email =
      user.email;

    if (
      typeof email !==
        "string" ||
      !email
    ) {
      return fail(
        "user_shape",
        500,
      );
    }

    const linkResponse =
      await fetch(
        new URL(
          "/auth/v1/admin/generate_link",
          supabaseUrl,
        ),
        {
          method:
            "POST",
          headers: {
            apikey:
              secretKey,
            accept:
              "application/json",
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              type:
                "magiclink",
              email,
            }),
          cache:
            "no-store",
          credentials:
            "omit",
          redirect:
            "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    if (
      !linkResponse.ok
    ) {
      return fail(
        "generate_link",
        linkResponse.status,
      );
    }

    const link =
      await linkResponse
        .json() as
        Record<
          string,
          unknown
        >;
    const properties =
      link.properties &&
      typeof link.properties ===
        "object" &&
      !Array.isArray(
        link.properties,
      )
        ? link.properties as
            Record<
              string,
              unknown
            >
        : link;
    const hashedToken =
      properties
        .hashed_token;

    if (
      typeof hashedToken !==
        "string" ||
      !hashedToken
    ) {
      return fail(
        "generate_link_shape",
        500,
      );
    }

    const verifyResponse =
      await fetch(
        new URL(
          "/auth/v1/verify",
          supabaseUrl,
        ),
        {
          method:
            "POST",
          headers: {
            apikey:
              publishableKey,
            accept:
              "application/json",
            "content-type":
              "application/json",
          },
          body:
            JSON.stringify({
              type:
                "email",
              token_hash:
                hashedToken,
            }),
          cache:
            "no-store",
          credentials:
            "omit",
          redirect:
            "error",
          referrerPolicy:
            "no-referrer",
        },
      );

    if (
      !verifyResponse.ok
    ) {
      return fail(
        "verify",
        verifyResponse.status,
      );
    }

    const auth =
      await verifyResponse
        .json() as
        Record<
          string,
          unknown
        >;
    const accessToken =
      auth.access_token;
    const expiresIn =
      auth.expires_in;

    if (
      typeof accessToken !==
        "string" ||
      !accessToken ||
      accessToken.length >
        8 * 1024 ||
      /[\s,]/.test(
        accessToken,
      )
    ) {
      return fail(
        "verify_shape",
        500,
      );
    }

    return json(
      200,
      {
        accessToken,
        expiresIn:
          typeof expiresIn ===
            "number"
            ? expiresIn
            : null,
        scope:
          "synthetic-preview-only",
      },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event:
          "voice_preview_auth_exception",
        detail:
          error instanceof Error
            ? error.message
            : "unknown",
      }),
    );

    return json(
      500,
      {
        error: {
          code:
            "PREVIEW_AUTH_FAILED",
          message:
            "Preview authentication failed",
        },
      },
    );
  }
}

export const POST =
  handle;
