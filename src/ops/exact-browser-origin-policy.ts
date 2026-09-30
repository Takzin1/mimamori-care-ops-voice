import type {
  CareOpsBrowserOriginPolicy,
} from "./types.ts";

export function canonicalBrowserOrigin(
  value: string,
): string {
  if (
    value === "null" ||
    value === "*" ||
    !value.trim()
  ) {
    throw new Error(
      "browser origin must be an exact http(s) origin",
    );
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "browser origin must be an exact http(s) origin",
    );
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new Error(
      "browser origin must use http or https",
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "browser origin must not include credentials, path, query, or fragment",
    );
  }

  if (url.origin !== value) {
    throw new Error(
      "browser origin must use canonical serialization",
    );
  }

  return url.origin;
}

export class ExactBrowserOriginPolicy
implements CareOpsBrowserOriginPolicy {
  readonly #origins: ReadonlySet<string>;

  constructor(
    origins: readonly string[],
  ) {
    if (origins.length < 1) {
      throw new Error(
        "at least one browser origin is required",
      );
    }

    this.#origins = new Set(
      origins.map(canonicalBrowserOrigin),
    );
  }

  allows(origin: string): boolean {
    let canonical: string;

    try {
      canonical =
        canonicalBrowserOrigin(origin);
    } catch {
      return false;
    }

    return this.#origins.has(canonical);
  }
}
