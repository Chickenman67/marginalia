export function createSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const ctrl = {
        supported: !!SR,
        start: () => { },
        stop: () => { },
        onResult: () => { },
        onState: () => { }
    };
    if (!SR)
        return ctrl;
    const rec = new SR();
    rec.interimResults = true;
    rec.continuous = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        ctrl.onResult(text);
    };
    rec.onend = () => ctrl.onState(false);
    rec.onerror = () => ctrl.onState(false);
    ctrl.start = () => {
        try {
            rec.start();
            ctrl.onState(true);
        }
        catch { /* already started */ }
    };
    ctrl.stop = () => rec.stop();
    return ctrl;
}
