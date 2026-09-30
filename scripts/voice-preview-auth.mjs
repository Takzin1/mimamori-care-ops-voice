import {
  appendFile,
} from "node:fs/promises";

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required`,
    );
  }

  return value;
}

function requireOrigin(
  value,
) {
  const url =
    new URL(value);

  if (
    url.protocol !== "https:" ||
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
      "CARE_OPS_SUPABASE_URL must be an https origin",
    );
  }

  return url.origin;
}

const supabaseUrl =
  requireOrigin(
    required(
      "CARE_OPS_SUPABASE_URL",
    ),
  );
const publishableKey =
  required(
    "CARE_OPS_SUPABASE_PUBLISHABLE_KEY",
  );
const email =
  required(
    "CARE_OPS_PREVIEW_AUTH_EMAIL",
  );
const password =
  required(
    "CARE_OPS_PREVIEW_AUTH_PASSWORD",
  );
const githubEnv =
  required(
    "GITHUB_ENV",
  );

if (
  publishableKey.length >
    16 * 1024 ||
  /[\r\n]/.test(
    publishableKey,
  )
) {
  throw new Error(
    "CARE_OPS_SUPABASE_PUBLISHABLE_KEY is malformed",
  );
}

if (
  email.length > 512 ||
  /[\r\n]/.test(email)
) {
  throw new Error(
    "CARE_OPS_PREVIEW_AUTH_EMAIL is malformed",
  );
}

if (
  password.length >
    16 * 1024 ||
  /[\r\n]/.test(password)
) {
  throw new Error(
    "CARE_OPS_PREVIEW_AUTH_PASSWORD is malformed",
  );
}

const endpoint =
  new URL(
    "/auth/v1/token?grant_type=password",
    supabaseUrl,
  );

const response =
  await fetch(
    endpoint,
    {
      method: "POST",
      headers: {
        accept:
          "application/json",
        apikey:
          publishableKey,
        "content-type":
          "application/json",
      },
      body:
        JSON.stringify({
          email,
          password,
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

const contentType =
  response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

if (
  contentType !==
    "application/json"
) {
  throw new Error(
    `Supabase Auth returned non-JSON HTTP ${response.status}`,
  );
}

const payload =
  await response.json();

if (!response.ok) {
  throw new Error(
    `Supabase Auth rejected synthetic Preview sign-in with HTTP ${response.status}`,
  );
}

const accessToken =
  payload?.access_token;

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
  throw new Error(
    "Supabase Auth response did not contain a usable access token",
  );
}

await appendFile(
  githubEnv,
  `CARE_OPS_ACCESS_TOKEN=${accessToken}\n`,
  {
    encoding:
      "utf8",
  },
);

console.log(
  "Fresh synthetic Supabase access token minted for Voice Preview live gate",
);
