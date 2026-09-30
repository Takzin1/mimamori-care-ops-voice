import test from "node:test";
import assert from "node:assert/strict";

import {
  clampAudioSample,
  float32ToPcm16Le,
  resampleMonoLinear,
} from "../src/voice/index.ts";

test("audio clamp handles invalid and out-of-range samples", () => {
  assert.equal(
    clampAudioSample(
      Number.NaN,
    ),
    0,
  );
  assert.equal(
    clampAudioSample(2),
    1,
  );
  assert.equal(
    clampAudioSample(-2),
    -1,
  );
});

test("PCM16 encoder writes little-endian signed samples", () => {
  const pcm =
    float32ToPcm16Le(
      new Float32Array([
        -1,
        0,
        1,
      ]),
    );

  assert.deepEqual(
    [...pcm],
    [
      0x00,
      0x80,
      0x00,
      0x00,
      0xff,
      0x7f,
    ],
  );
});

test("linear resampler reduces sample count deterministically", () => {
  const input =
    new Float32Array([
      0,
      0.25,
      0.5,
      0.75,
      1,
      0.75,
      0.5,
      0.25,
    ]);

  const output =
    resampleMonoLinear(
      input,
      48_000,
      16_000,
    );

  assert.equal(
    output.length,
    2,
  );
  assert.equal(
    output[0],
    0,
  );
  assert.equal(
    output[1],
    0.75,
  );
});
