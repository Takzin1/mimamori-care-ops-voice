import type { ObservationState } from './types.ts';

export const CRITICAL_FACT_KEYS = ['fall', 'collapse', 'fever', 'consciousness', 'breathing', 'injury', 'uncertainty'] as const;
export type CriticalFactKey = typeof CRITICAL_FACT_KEYS[number];
export interface EvidenceSpan { quote: string; start: number; end: number }
export type CriticalFacts = Record<CriticalFactKey, ObservationState>;
export type CriticalFactEvidence = Record<CriticalFactKey, EvidenceSpan[]>;

// confirmed means the named observation is present, not medically verified.
// consciousness/breathing: confirmed = present; denied = explicitly absent.
const patterns: Record<Exclude<CriticalFactKey, 'uncertainty'>, { yes: RegExp; no: RegExp }> = {
  fall: {
    yes: /転倒(?:しました|した|しています|している)|転(?:びました|んだ|んでいます)|\b(?:fell down|did fall|jatuh)\b/giu,
    no: /転倒(?:は)?(?:していません|していない|してない|ありません|なし|には至っていません|には至らず)|転んで(?:いません|いない|ない)|\b(?:did not (?:actually )?fall|didn't fall|almost fell(?: down)?|tidak jatuh|hampir jatuh)\b/giu,
  },
  collapse: {
    yes: /倒れ(?:ています|ている|ました|た|込んでいます)|\b(?:collapsed|has collapsed)\b/giu,
    no: /倒れ(?:ていません|ていない|てない)|\b(?:did not collapse|has not collapsed|hasn't collapsed|not collapsed)\b/giu,
  },
  fever: {
    yes: /高熱(?:を出|が出|です|で|があり)|発熱(?:は|が)?(?:あります|ある|あり|しています|している|しました|した|です)|熱(?:が|を)(?:出|あり|ある)|\b(?:has (?:a )?fever|have (?:a )?fever|is feverish|mengalami demam)\b/giu,
    no: /(?:発熱|(?<!高|微)熱)(?:は|が)?(?:ありません|ない|なし)|\b(?:no fever|does not have (?:a )?fever|doesn't have (?:a )?fever|tidak demam)\b/giu,
  },
  consciousness: {
    yes: /意識(?:は|が)?(?:あります|ある|あり)|呼びかけに反応(?:が)?あります|\b(?:conscious|awake)\b/giu,
    no: /意識(?:は|が)?(?:ありません|ない|なし)|呼びかけに反応がない|\b(?:unconscious|not conscious|not awake)\b/giu,
  },
  breathing: {
    yes: /呼吸(?:は|が)?(?:あります|ある|あり)|呼吸しています|\b(?:is breathing|breathing normally)\b/giu,
    no: /呼吸(?:は|が)?(?:ありません|ない|なし)|呼吸していない|\b(?:not breathing|no breathing)\b/giu,
  },
  injury: {
    yes: /(?:外傷|けが|怪我|出血)(?:は|が)?(?:あります|ある|あり)|出血しています|大量出血|\b(?:injured|bleeding|has an injury)\b/giu,
    no: /(?:外傷|けが|怪我|出血)(?:は|が)?(?:ありません|ない|なし)|\b(?:no injury|not injured|not bleeding|no bleeding)\b/giu,
  },
};
const uncertain = /不明|わから|分から|確認でき|確認していません|未確認|かもしれ|かどうか|したか|したのか|だか|疑い|可能性|たぶん|おそらく|\b(?:unknown|uncertain|unsure|maybe|possibly|not sure|whether)\b/iu;
const nonAssertion = /[?？「」『』"]|もし|場合|仮に|リスク|教えて|出力|昨日|以前|過去|ない|ません|ではなく|じゃなく|\b(?:if|hypothetical|risk|instruction|yesterday|previously|history|not|never|without|no)\b/iu;

export function extractCriticalFacts(text: string): { facts: CriticalFacts; factEvidence: CriticalFactEvidence } {
  const facts = Object.fromEntries(CRITICAL_FACT_KEYS.map(k => [k, 'unknown'])) as CriticalFacts;
  const factEvidence = Object.fromEntries(CRITICAL_FACT_KEYS.map(k => [k, []])) as unknown as CriticalFactEvidence;
  const seen = new Map<CriticalFactKey, Set<ObservationState>>();
  for (const match of text.matchAll(/[^。.!！?？\n]+[。.!！?？]?/gu)) {
    const clause = match[0];
    const span = { quote: clause, start: match.index!, end: match.index! + clause.length };
    const hasFactMention = /転倒|転ん|倒れ|熱|意識|反応|呼吸|外傷|けが|怪我|出血|fall|fell|jatuh|collaps|fever|demam|conscious|awake|breath|injur|bleed/iu.test(clause);
    if (uncertain.test(clause) || (/[?？]/u.test(clause) && hasFactMention)) {
      facts.uncertainty = 'confirmed';
      factEvidence.uncertainty.push(span);
      const mentions = { fall: /転倒|転ん|fall|fell|jatuh/iu, collapse: /倒れ|collaps/iu, fever: /熱|fever|demam/iu, consciousness: /意識|反応|conscious|awake/iu, breathing: /呼吸|breath/iu, injury: /外傷|けが|怪我|出血|injur|bleed/iu };
      for (const key of Object.keys(mentions) as (keyof typeof mentions)[]) {
        if (mentions[key].test(clause)) {
          const states = seen.get(key) ?? new Set<ObservationState>();
          states.add('unknown'); seen.set(key, states); factEvidence[key].push(span);
        }
      }
      continue;
    }
    for (const key of CRITICAL_FACT_KEYS) {
      if (key === 'uncertainty') continue;
      const { yes, no } = patterns[key];
      const negativeMatches = [...clause.matchAll(no)];
      const remainder = clause.replace(no, '');
      const positiveMatches = [...remainder.matchAll(yes)];
      // Unknown grammar, quoted/instructional, hypothetical or historical reports fail closed.
      if (nonAssertion.test(remainder)) continue;
      const states = seen.get(key) ?? new Set<ObservationState>();
      if (negativeMatches.length) states.add('denied');
      if (positiveMatches.length) states.add('confirmed');
      if (negativeMatches.length || positiveMatches.length) factEvidence[key].push(span);
      seen.set(key, states);
    }
  }
  for (const [key, states] of seen) {
    facts[key] = states.size === 1 ? [...states][0]! : 'unknown';
    if (states.size > 1) {
      facts.uncertainty = 'confirmed';
      factEvidence.uncertainty.push(...factEvidence[key]);
    }
  }
  return { facts, factEvidence };
}
