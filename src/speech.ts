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

  let acc = "";
  const rec = new SR();
  rec.interimResults = true;
  rec.continuous = true;
  rec.lang = navigator.language || "en-US";

  rec.onresult = (e: any) => {
    let chunk = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      chunk += e.results[i][0].transcript;
    }
    if (e.results[e.results.length - 1].isFinal) { acc += chunk + " "; }
    ctrl.onResult(acc.trim());
  };
  rec.onend = () => ctrl.onState(false);
  rec.onerror = () => ctrl.onState(false);
  ctrl.start = () => {
    acc = "";
    try { rec.start(); ctrl.onState(true); } catch { /* already started */ }
  };
  ctrl.stop = () => rec.stop();
  return ctrl;
}
