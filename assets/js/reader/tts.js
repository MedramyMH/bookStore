// Auto-reader: reads the book aloud page after page with the browser's speech engine
// (Web Speech API — free, works offline on most devices; voice quality depends on the device).

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
export const ttsSupported = () => !!synth && typeof SpeechSynthesisUtterance !== "undefined";

const QUALITY = /(natural|neural|premium|enhanced|google|online|siri|wavenet)/i;

export function getVoices() {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const list = synth.getVoices();
    if (list.length) return resolve(list);
    const done = () => resolve(synth.getVoices());
    synth.addEventListener?.("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export function voicesFor(voices, lang) {
  return voices
    .filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith(lang))
    .sort((a, b) => (QUALITY.test(b.name) - QUALITY.test(a.name)) || (b.localService - a.localService) || a.name.localeCompare(b.name));
}

/** Split page text into speakable sentences (≤ ~220 chars each). */
export function splitSentences(text) {
  const clean = String(text || "").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!clean) return [];
  const raw = clean.match(/[^.!?؟。…;؛]+(?:[.!?؟。…;؛]+["'»”’)\]]*|$)\s*/gu) || [clean];
  const out = [];
  for (let s of raw) {
    s = s.trim();
    if (!s) continue;
    while (s.length > 220) {
      let cut = Math.max(s.lastIndexOf("،", 200), s.lastIndexOf(",", 200), s.lastIndexOf(" ", 200));
      if (cut < 60) cut = 200;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) {
      // glue very short fragments (page numbers, initials) to the previous sentence
      if (out.length && s.length < 12 && out[out.length - 1].length < 180) out[out.length - 1] += " " + s;
      else out.push(s);
    }
  }
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export class AutoReader {
  /**
   * @param {object} o
   * @param {string} o.lang           'ar' | 'en' | 'fr'
   * @param {number} o.totalPages
   * @param {(page:number)=>Promise<string>} o.getText
   * @param {(page:number)=>void} o.onPage           called when reading moves to another page
   * @param {(state:string)=>void} o.onState         'playing' | 'paused' | 'stopped' | 'notext' | 'error'
   * @param {(info:{page:number,index:number,sentences:string[]})=>void} o.onSentence
   */
  constructor(o) {
    Object.assign(this, o);
    this.page = 1;
    this.index = 0;
    this.sentences = [];
    this.rate = Number(localStorage.getItem("tts-rate")) || 1;
    this.autoTurn = localStorage.getItem("tts-autoturn") !== "0";
    this.voice = null;
    this.state = "stopped";
    this.token = 0;
    this.emptyRun = 0;
    this.failRun = 0;
  }

  setVoice(voice) {
    this.voice = voice || null;
    if (voice) localStorage.setItem(`tts-voice-${this.lang}`, voice.name);
    if (this.state === "playing") this.#restartSentence();
  }
  setRate(r) {
    this.rate = r; localStorage.setItem("tts-rate", String(r));
    if (this.state === "playing") this.#restartSentence();
  }
  setAutoTurn(on) { this.autoTurn = on; localStorage.setItem("tts-autoturn", on ? "1" : "0"); }

  async start(page, index = 0) {
    this.#cancel();
    this.page = page;
    this.emptyRun = 0;
    await this.#loadPage(page);
    this.index = Math.min(index, Math.max(0, this.sentences.length - 1));
    this.#setState("playing");
    this.#speak();
  }

  pause() {
    if (this.state !== "playing") return;
    this.#cancel();
    this.#setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.#setState("playing");
    this.#speak();
  }

  toggle(page) {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
    else this.start(page);
  }

  stop() {
    this.#cancel();
    this.#setState("stopped");
  }

  next() { if (this.index < this.sentences.length - 1) { this.index++; this.#restartSentence(); } else this.#advancePage(); }
  prev() { if (this.index > 0) { this.index--; this.#restartSentence(); } }

  destroy() { this.#cancel(); this.state = "stopped"; }

  // ---------------------------------------------------------------- internals
  #setState(s) { this.state = s; this.onState?.(s); }

  #cancel() {
    this.token++;
    try { synth?.cancel(); } catch {}
  }

  #restartSentence() {
    if (this.state !== "playing") { this.onSentence?.({ page: this.page, index: this.index, sentences: this.sentences }); return; }
    this.#cancel();
    this.#speak();
  }

  async #loadPage(page) {
    try {
      this.sentences = splitSentences(await this.getText(page));
    } catch {
      this.sentences = [];
    }
    this.index = 0;
  }

  async #advancePage() {
    const my = ++this.token;
    if (!this.autoTurn || this.page >= this.totalPages) {
      this.#setState("stopped");
      if (this.page >= this.totalPages) this.onFinished?.();
      return;
    }
    this.page += 1;
    this.onPage?.(this.page);
    await this.#loadPage(this.page);
    if (my !== this.token || this.state !== "playing") return;
    this.#speak();
  }

  #speak() {
    const my = ++this.token;
    if (!this.sentences.length) {
      // Page without text (image / scanned page): skip it, but give up after many in a row
      this.emptyRun++;
      if (this.emptyRun > 4) { this.#setState("notext"); return; }
      setTimeout(() => my === this.token && this.#advancePage(), 400);
      return;
    }
    this.emptyRun = 0;
    this.onSentence?.({ page: this.page, index: this.index, sentences: this.sentences });

    const u = new SpeechSynthesisUtterance(this.sentences[this.index]);
    u.lang = this.voice?.lang || { ar: "ar-SA", en: "en-US", fr: "fr-FR" }[this.lang] || this.lang;
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.onend = () => {
      if (my !== this.token || this.state !== "playing") return;
      this.failRun = 0;
      if (this.index < this.sentences.length - 1) { this.index++; this.#speak(); }
      else this.#advancePage();
    };
    u.onerror = (e) => {
      if (my !== this.token) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      console.warn("TTS error", e.error);
      // the speech engine is unavailable → stop instead of skipping through the book
      if (++this.failRun >= 3) { this.failRun = 0; this.#cancel(); this.#setState("error"); return; }
      // a single bad sentence → continue with the next one
      if (this.index < this.sentences.length - 1) { this.index++; setTimeout(() => my === this.token && this.#speak(), 200); }
      else this.#setState("error");
    };
    // Chrome sometimes stays paused after a cancel → resume first
    try { synth.resume(); } catch {}
    synth.speak(u);
  }
}
