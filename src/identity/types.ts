export interface AuthenticatedPrincipal {
  principalId: string;
  provider: string;
}

export interface PrincipalAuthenticator {
  authenticate(accessToken: string): Promise<AuthenticatedPrincipal>;
}

export class AuthenticationError extends Error {
  readonly code = "AUTHENTICATION_FAILED";

  constructor(message = "Authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}
