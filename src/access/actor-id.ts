export const OPERATIONAL_ACTOR_ID_PATTERN =
  /^[A-Za-z0-9._:-]{1,128}$/;

export function isOperationalActorId(
  value: string,
): boolean {
  return OPERATIONAL_ACTOR_ID_PATTERN.test(
    value,
  );
}
