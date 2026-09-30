import type {
  GuidancePlan,
  GuidanceTranslator,
  LocalizedGuidance,
  NextAction,
} from "./types.ts";

export interface ClaudeGuidanceLocalizationRequest {
  locale: string;
  policyId: string;
  policyVersion: string;
  headingInstruction: string;
  boundaryMessage: string;
  actions: ReadonlyArray<{
    id: string;
    label: string;
    instruction: string;
  }>;
}

export interface ClaudeGuidanceTransport {
  localize(
    request:
      ClaudeGuidanceLocalizationRequest,
  ): Promise<unknown>;
}

export interface ClaudeGuidanceTranslatorOptions {
  transport: ClaudeGuidanceTransport;
}

const MAX_TEXT = 2_000;

function textField(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string"
  ) {
    throw new Error(
      `Claude guidance ${label} must be text`,
    );
  }

  const normalized =
    value.trim();

  if (
    !normalized ||
    normalized.length >
      MAX_TEXT
  ) {
    throw new Error(
      `Claude guidance ${label} is invalid`,
    );
  }

  return normalized;
}

function object(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `Claude guidance ${label} must be an object`,
    );
  }

  return value as Record<
    string,
    unknown
  >;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const keys =
    Object.keys(value);

  if (
    keys.length !==
      allowed.length ||
    keys.some(
      (key) =>
        !allowed.includes(key),
    )
  ) {
    throw new Error(
      `Claude guidance ${label} has unexpected or missing fields`,
    );
  }
}

function parseResponse(
  value: unknown,
  source:
    GuidancePlan,
  locale: string,
): LocalizedGuidance {
  const record =
    object(
      value,
      "response",
    );

  exactKeys(
    record,
    [
      "heading",
      "boundaryMessage",
      "actions",
    ],
    "response",
  );

  const rawActions =
    record.actions;

  if (
    !Array.isArray(
      rawActions,
    )
  ) {
    throw new Error(
      "Claude guidance actions must be an array",
    );
  }

  if (
    rawActions.length !==
      source.actions.length
  ) {
    throw new Error(
      "Claude guidance must preserve every SOP action",
    );
  }

  const actions:
    NextAction[] = source.actions
      .map(
        (
          original,
          index,
        ) => {
          const localized =
            object(
              rawActions[
                index
              ],
              `action ${index}`,
            );

          exactKeys(
            localized,
            [
              "id",
              "label",
              "instruction",
            ],
            `action ${index}`,
          );

          if (
            localized.id !==
              original.id
          ) {
            throw new Error(
              "Claude guidance must preserve SOP action IDs and order",
            );
          }

          return {
            ...original,
            label:
              textField(
                localized.label,
                `action ${original.id} label`,
              ),
            instruction:
              textField(
                localized.instruction,
                `action ${original.id} instruction`,
              ),
          };
        },
      );

  return {
    locale,
    heading:
      textField(
        record.heading,
        "heading",
      ),
    actions,
    boundaryMessage:
      textField(
        record.boundaryMessage,
        "boundaryMessage",
      ),
  };
}

export class ClaudeGuidanceTranslator
implements GuidanceTranslator {
  readonly #transport:
    ClaudeGuidanceTransport;

  constructor(
    options:
      ClaudeGuidanceTranslatorOptions,
  ) {
    this.#transport =
      options.transport;
  }

  async translate(input: {
    plan: GuidancePlan;
    locale: string;
  }): Promise<LocalizedGuidance> {
    const locale =
      input.locale.trim();

    if (
      !/^[A-Za-z0-9-]{2,64}$/.test(
        locale,
      )
    ) {
      throw new Error(
        "Claude guidance locale is invalid",
      );
    }

    const response =
      await this.#transport
        .localize({
          locale,
          policyId:
            input.plan.policyId,
          policyVersion:
            input.plan
              .policyVersion,
          headingInstruction:
            "Return a short heading in the target locale. Translate only; do not add, remove, reorder, or reinterpret SOP actions.",
          boundaryMessage:
            input.plan
              .boundaryMessage,
          actions:
            input.plan.actions
              .map(
                (action) => ({
                  id:
                    action.id,
                  label:
                    action.label,
                  instruction:
                    action.instruction,
                }),
              ),
        });

    return parseResponse(
      response,
      input.plan,
      locale,
    );
  }
}
