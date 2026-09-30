import { BedrockSituationUnderstandingProvider, RuleBasedSituationUnderstandingProvider, situationProviderFromEnvironment } from '../src/voice/index.ts';

const live = process.argv.includes('--bedrock');
const n = live ? 5 : 100;
const texts = ['高熱を出して倒れています。', '転倒はしていません。今は座っています。', '意識がない。呼吸していない。', '転倒したか確認できません。', '発熱はありません。'];
const selected = live ? situationProviderFromEnvironment(process.env) : new RuleBasedSituationUnderstandingProvider();
if (live && !(selected instanceof BedrockSituationUnderstandingProvider)) throw new Error('Explicit Bedrock server configuration is required');
const samples = [];
let fallbacks = 0;
for (let i = 0; i < n; i++) {
  const result = await selected.understand({ subjectId: 'synthetic-benchmark', transcript: { provider: 'assemblyai', transcriptId: `synthetic-${i}`, text: texts[i % texts.length], language: 'ja', capturedAt: '2026-09-30T02:00:00Z' } });
  samples.push(result.processing.durationMs);
  if (result.processing.fallbackReason) fallbacks++;
}
samples.sort((a,b) => a-b);
const percentile = p => Number(samples[Math.ceil(samples.length * p) - 1].toFixed(3));
console.log(JSON.stringify({ mode: live ? 'live_bedrock_synthetic_text' : 'local_rule_based', n, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1), fallbacks, microphone: false }, null, 2));
if (live && fallbacks) process.exitCode = 1;
