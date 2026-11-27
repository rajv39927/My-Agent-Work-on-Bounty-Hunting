// Sound, synthesized with WebAudio: no audio files, no network. Every
// effect is a short oscillator phrase; the game stays silent until the
// player first presses a key or clicks, which is when the context is made.
export function createAudio() {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (ctx === null) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
      } catch {
        ctx = null;
      }
    }
    if (ctx !== null && ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function tone(freq, at, dur, type, gain) {
    const ac = ctx;
    if (ac === null) return;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0, ac.currentTime + at);
    amp.gain.linearRampToValueAtTime(gain, ac.currentTime + at + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + at + dur);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(ac.currentTime + at);
    osc.stop(ac.currentTime + at + dur + 0.05);
  }

  function phrase(notes, type, gain) {
    if (ensure() === null || muted) return;
    let at = 0;
    for (const [freq, dur] of notes) {
      tone(freq, at, dur, type, gain);
      at += dur * 0.8;
    }
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    gobble() {
      phrase([[420, 0.09], [300, 0.11], [380, 0.09]], 'square', 0.05);
    },
    pickup() {
      phrase([[660, 0.08], [880, 0.12]], 'sine', 0.08);
    },
    hat() {
      phrase([[523, 0.1], [659, 0.1], [784, 0.16]], 'triangle', 0.08);
    },
    spotted() {
      phrase([[196, 0.12], [185, 0.14]], 'sawtooth', 0.07);
    },
    hidden() {
      phrase([[330, 0.14]], 'sine', 0.05);
    },
    hit() {
      phrase([[120, 0.2], [80, 0.25]], 'sawtooth', 0.1);
    },
    caught() {
      phrase([[392, 0.16], [311, 0.16], [233, 0.3]], 'triangle', 0.09);
    },
    escaped() {
      phrase([[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.3]], 'triangle', 0.09);
    },
    stage() {
      phrase([[587, 0.1], [880, 0.18]], 'sine', 0.06);
    },
  };
}
