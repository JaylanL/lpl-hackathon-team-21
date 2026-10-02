// Live speech-to-text. Primary: Amazon Transcribe streaming (browser -> Transcribe, guest creds via Cognito).
// Fallback: the browser's Web Speech API, so the demo still works if Transcribe is unavailable.
import { TranscribeStreamingClient, StartStreamTranscriptionCommand } from "@aws-sdk/client-transcribe-streaming";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";

let client = null;
function getClient(cfg) {
  if (!client) {
    client = new TranscribeStreamingClient({
      region: cfg.region,
      credentials: fromCognitoIdentityPool({ client: new CognitoIdentityClient({ region: cfg.region }), identityPoolId: cfg.identityPoolId }),
    });
  }
  return client;
}

async function startTranscribe(cfg, onText) {
  const media = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(media);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const queue = [];
  let wake = null;
  let running = true;
  proc.onaudioprocess = (e) => {
    const f = e.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    queue.push(new Uint8Array(pcm.buffer));
    if (wake) { wake(); wake = null; }
  };
  src.connect(proc);
  proc.connect(ctx.destination);

  async function* audio() {
    while (running) {
      if (!queue.length) await new Promise((r) => (wake = r));
      while (queue.length) yield { AudioEvent: { AudioChunk: queue.shift() } };
    }
  }
  const cleanup = () => {
    running = false;
    if (wake) wake();
    try { proc.disconnect(); src.disconnect(); } catch (_) {}
    media.getTracks().forEach((t) => t.stop());
    ctx.close();
  };

  try {
    const res = await getClient(cfg).send(new StartStreamTranscriptionCommand({
      IdentifyLanguage: true,
      LanguageOptions: "en-US,es-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      AudioStream: audio(),
    }));
    let committed = "";
    (async () => {
      try {
        for await (const ev of res.TranscriptResultStream) {
          const r = ev.TranscriptEvent?.Transcript?.Results?.[0];
          const alt = r?.Alternatives?.[0]?.Transcript;
          if (!alt) continue;
          if (r.IsPartial) onText((committed + " " + alt).trim(), false);
          else { committed = (committed + " " + alt).trim(); onText(committed, true); }
        }
      } catch (err) { console.warn("[dictation] stream ended", err); }
    })();
    return { stop: cleanup, engine: "Amazon Transcribe" };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function startWebSpeech(lang, onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("Speech recognition not supported in this browser");
  const rec = new SR();
  rec.lang = lang === "es" ? "es-US" : "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  rec.onresult = (e) => {
    let text = "";
    let final = true;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (!e.results[i].isFinal) final = false;
    }
    onText(text.trim(), final);
  };
  rec.start();
  return { stop: () => rec.stop(), engine: "browser speech" };
}

export async function startDictation(cfg, lang, onText) {
  if (cfg.identityPoolId) {
    try {
      return await startTranscribe(cfg, onText);
    } catch (err) {
      console.warn("[dictation] Transcribe unavailable, falling back to Web Speech", err);
    }
  }
  return startWebSpeech(lang, onText);
}
