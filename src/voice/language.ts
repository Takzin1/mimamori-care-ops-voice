import type {
  GuidancePlan,
  GuidanceTranslator,
  LocalizedGuidance,
  NextAction,
} from "./types.ts";

export class PassthroughGuidanceTranslator
  implements GuidanceTranslator
{
  async translate(input: {
    plan: GuidancePlan;
    locale: string;
  }): Promise<LocalizedGuidance> {
    return {
      locale: input.locale,
      heading: "次にやること",
      actions: input.plan.actions.map((item) => ({ ...item })),
      boundaryMessage: input.plan.boundaryMessage,
    };
  }
}

const ID_ACTIONS: Record<string, string> = {
  "ensure-safety":
    "Pastikan pengguna berada dalam posisi yang aman dan jangan memaksanya berdiri kembali.",
  "observe-condition":
    "Periksa kesadaran, nyeri, luka, dan apakah pusing atau sempoyongan masih berlanjut.",
  "notify-supervisor":
    "Laporkan fakta yang sudah dikonfirmasi kepada penanggung jawab sesuai aturan tempat kerja.",
  "follow-emergency-procedure":
    "Hentikan rekomendasi AI dan ikuti prosedur darurat organisasi.",
};

function localizeAction(
  action: NextAction,
): NextAction {
  const instruction = ID_ACTIONS[action.id];
  return {
    ...action,
    label: {
      "ensure-safety": "Pastikan keselamatan",
      "observe-condition": "Periksa kondisi",
      "notify-supervisor": "Laporkan kepada penanggung jawab",
      "follow-emergency-procedure": "Ikuti prosedur darurat",
    }[action.id] ?? action.label,
    instruction: instruction ?? action.instruction,
  };
}

export class DemoIndonesianGuidanceTranslator
  implements GuidanceTranslator
{
  async translate(input: {
    plan: GuidancePlan;
    locale: string;
  }): Promise<LocalizedGuidance> {
    if (!input.locale.toLowerCase().startsWith("id")) {
      return new PassthroughGuidanceTranslator().translate(input);
    }

    return {
      locale: input.locale,
      heading: "Langkah berikutnya",
      actions: input.plan.actions.map(localizeAction),
      boundaryMessage:
        "Panduan ini tidak membuat diagnosis atau keputusan akhir tentang tingkat kegawatan. Ikuti SOP organisasi dan keputusan petugas yang bertanggung jawab.",
    };
  }
}
