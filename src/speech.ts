// Web Speech API capture. Feature-detected; falls back to text silently.
export interface SpeechController {
  supported: boolean;
  start(): void;
  stop(): void;
  onResult: (text: string) => void;
  onState: (listening: boolean) => void;
}

export function createSpeech(): SpeechController {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const ctrl: SpeechController = {
    supported: !!SR,
    start: () => {},
    stop: () => {},
    onResult: () => {},
    onState: () => {}
  };
  if (!SR) return ctrl;

  const rec = new SR();
  rec.interimResults = true;
  rec.continuous = false;
  rec.lang = navigator.language || "en-US";

  rec.onresult = (e: any) => {
    const text = e.results[0][0].transcript;
    ctrl.onResult(text);
  };
  rec.onend = () => ctrl.onState(false);
  rec.onerror = () => ctrl.onState(false);
  ctrl.start = () => {
    try { rec.start(); ctrl.onState(true); } catch { /* already started */ }
  };
  ctrl.stop = () => rec.stop();
  return ctrl;
}
