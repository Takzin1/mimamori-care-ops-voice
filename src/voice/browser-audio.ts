export function clampAudioSample(
  value: number,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(
    -1,
    Math.min(1, value),
  );
}

export function resampleMonoLinear(
  samples: Float32Array,
  inputSampleRateHz: number,
  outputSampleRateHz: number,
): Float32Array {
  if (
    !Number.isFinite(inputSampleRateHz) ||
    !Number.isFinite(outputSampleRateHz) ||
    inputSampleRateHz <= 0 ||
    outputSampleRateHz <= 0
  ) {
    throw new Error(
      "sample rates must be positive",
    );
  }

  if (
    samples.length === 0
  ) {
    return new Float32Array();
  }

  if (
    inputSampleRateHz ===
    outputSampleRateHz
  ) {
    return new Float32Array(
      samples,
    );
  }

  const outputLength =
    Math.max(
      1,
      Math.floor(
        samples.length *
          outputSampleRateHz /
          inputSampleRateHz,
      ),
    );

  const output =
    new Float32Array(
      outputLength,
    );
  const ratio =
    inputSampleRateHz /
    outputSampleRateHz;

  for (
    let index = 0;
    index < outputLength;
    index += 1
  ) {
    const sourcePosition =
      index * ratio;
    const left =
      Math.floor(
        sourcePosition,
      );
    const right =
      Math.min(
        left + 1,
        samples.length - 1,
      );
    const fraction =
      sourcePosition - left;

    const leftValue =
      samples[
        Math.min(
          left,
          samples.length - 1,
        )
      ] ?? 0;
    const rightValue =
      samples[right] ?? leftValue;

    output[index] =
      leftValue +
      (
        rightValue -
        leftValue
      ) *
        fraction;
  }

  return output;
}

export function float32ToPcm16Le(
  samples: Float32Array,
): Uint8Array {
  const buffer =
    new ArrayBuffer(
      samples.length * 2,
    );
  const view =
    new DataView(
      buffer,
    );

  for (
    let index = 0;
    index < samples.length;
    index += 1
  ) {
    const sample =
      clampAudioSample(
        samples[index] ?? 0,
      );

    const pcm =
      sample < 0
        ? Math.round(
            sample * 0x8000,
          )
        : Math.round(
            sample * 0x7fff,
          );

    view.setInt16(
      index * 2,
      pcm,
      true,
    );
  }

  return new Uint8Array(
    buffer,
  );
}

export interface BrowserMicrophoneCaptureOptions {
  targetSampleRateHz: number;
  onAudioChunk(
    chunk: Uint8Array,
  ): void;
  getUserMedia?: (
    constraints:
      MediaStreamConstraints,
  ) => Promise<MediaStream>;
  audioContextFactory?: () =>
    AudioContext;
  bufferSize?: number;
}

export class BrowserMicrophoneCapture {
  readonly #targetSampleRateHz:
    number;
  readonly #onAudioChunk:
    (chunk: Uint8Array) => void;
  readonly #getUserMedia:
    (
      constraints:
        MediaStreamConstraints,
    ) => Promise<MediaStream>;
  readonly #audioContextFactory:
    () => AudioContext;
  readonly #bufferSize:
    number;

  #stream:
    MediaStream | null = null;
  #context:
    AudioContext | null = null;
  #source:
    MediaStreamAudioSourceNode | null =
      null;
  #processor:
    ScriptProcessorNode | null =
      null;
  #silentGain:
    GainNode | null = null;

  constructor(
    options:
      BrowserMicrophoneCaptureOptions,
  ) {
    if (
      !Number.isInteger(
        options.targetSampleRateHz,
      ) ||
      options.targetSampleRateHz <
        8_000 ||
      options.targetSampleRateHz >
        96_000
    ) {
      throw new Error(
        "target sample rate is invalid",
      );
    }

    this.#targetSampleRateHz =
      options.targetSampleRateHz;
    this.#onAudioChunk =
      options.onAudioChunk;
    this.#getUserMedia =
      options.getUserMedia ??
      ((constraints) =>
        navigator.mediaDevices
          .getUserMedia(
            constraints,
          ));
    this.#audioContextFactory =
      options.audioContextFactory ??
      (() =>
        new AudioContext());
    this.#bufferSize =
      options.bufferSize ??
      4096;
  }

  async start():
    Promise<void> {
    if (
      this.#stream ||
      this.#context
    ) {
      throw new Error(
        "microphone capture is already active",
      );
    }

    const stream =
      await this.#getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

    const context =
      this.#audioContextFactory();

    try {
      const source =
        context
          .createMediaStreamSource(
            stream,
          );
      const processor =
        context
          .createScriptProcessor(
            this.#bufferSize,
            1,
            1,
          );
      const silentGain =
        context.createGain();

      silentGain.gain.value = 0;

      processor.onaudioprocess =
        (event) => {
          const input =
            event.inputBuffer
              .getChannelData(
                0,
              );
          const resampled =
            resampleMonoLinear(
              input,
              context.sampleRate,
              this.#targetSampleRateHz,
            );
          const pcm =
            float32ToPcm16Le(
              resampled,
            );

          if (
            pcm.byteLength > 0
          ) {
            this.#onAudioChunk(
              pcm,
            );
          }
        };

      source.connect(
        processor,
      );
      processor.connect(
        silentGain,
      );
      silentGain.connect(
        context.destination,
      );

      this.#stream =
        stream;
      this.#context =
        context;
      this.#source =
        source;
      this.#processor =
        processor;
      this.#silentGain =
        silentGain;
    } catch (error) {
      for (
        const track of
          stream.getTracks()
      ) {
        track.stop();
      }

      await context.close();

      throw error;
    }
  }

  async stop():
    Promise<void> {
    this.#processor
      ?.disconnect();
    this.#source
      ?.disconnect();
    this.#silentGain
      ?.disconnect();

    if (this.#processor) {
      this.#processor.onaudioprocess =
        null;
    }

    if (this.#stream) {
      for (
        const track of
          this.#stream
            .getTracks()
      ) {
        track.stop();
      }
    }

    if (
      this.#context &&
      this.#context.state !==
        "closed"
    ) {
      await this.#context
        .close();
    }

    this.#stream = null;
    this.#context = null;
    this.#source = null;
    this.#processor = null;
    this.#silentGain = null;
  }
}
