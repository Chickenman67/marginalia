export interface WhisperController {
  supported: boolean;
  start(): Promise<void>;
  stop(): Promise<string>;
  onState: (listening: boolean) => void;
}

type Transcriber = (audio: Float32Array) => Promise<{ text: string }>;

export function createWhisper(): WhisperController {
  const ctrl: WhisperController = {
    supported:
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    start: async () => {},
    stop: async () => "",
    onState: () => {}
  };
  if (!ctrl.supported) return ctrl;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let transcriber: Transcriber | null = null;

  ctrl.start = async () => {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
    ctrl.onState(true);
  };

  ctrl.stop = async () => {
    if (!recorder) return "";
    const done = new Promise<string>(async (resolve) => {
      recorder!.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder!.mimeType || "audio/webm" });
          const buf = await blob.arrayBuffer();
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const ac = new AudioCtx();
          const audioBuf = await ac.decodeAudioData(buf);
          const samples = await resampleTo16k(audioBuf);
          if (!transcriber) {
            const mod = await import("@huggingface/transformers");
            transcriber = (await mod.pipeline(
              "automatic-speech-recognition",
              "Xenova/whisper-tiny.en",
              { device: "wasm", dtype: "q8" }
            )) as unknown as Transcriber;
          }
          const out = await transcriber(samples);
          resolve((out.text || "").trim());
        } catch (err) {
          console.error("whisper failed", err);
          resolve("");
        } finally {
          stream?.getTracks().forEach((t) => t.stop());
          ctrl.onState(false);
        }
      };
      recorder!.stop();
    });
    return done;
  };

  return ctrl;
}

async function resampleTo16k(audioBuf: AudioBuffer): Promise<Float32Array> {
  const targetRate = 16000;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(audioBuf.duration * targetRate),
    targetRate
  );
  const src = offline.createBufferSource();
  src.buffer = audioBuf;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}
