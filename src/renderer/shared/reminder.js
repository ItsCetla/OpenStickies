// Reminder helpers shared by note windows and the notes list, so both agree on the
// countdown wording, the urgency thresholds and the alert sound.

const HOUR = 3600 * 1000;
const REPEAT_WORD = { daily: 'daily', weekdays: 'on weekdays', weekly: 'weekly', monthly: 'monthly' };

export function dueAt(r) {
  return r ? (r.snoozeAt || r.at) : null;
}

// 'green' | 'orange' | 'red', or null without a reminder.
export function urgency(r, now = Date.now()) {
  if (!r || !Number.isFinite(r.at)) return null;
  const at = dueAt(r);
  if (r.pending || at <= now || at - now < HOUR) return 'red';
  const setAt = Number.isFinite(r.setAt) ? r.setAt : now;
  const span = at - setAt;
  if (span <= 0) return 'red';
  const u = (now - setAt) / span;
  if (u >= 0.9) return 'red';
  if (u >= 0.5) return 'orange';
  return 'green';
}

function duration(ms) {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function clockLabel(t, now) {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return `Today ${time}`;
  if (new Date(now + 86400000).toDateString() === d.toDateString()) return `Tomorrow ${time}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}

// "in 2h 15m", "Tomorrow 9:00", "Overdue by 3h", plus "Repeats daily" for repeating ones.
export function relativeLabel(r, now = Date.now()) {
  if (!r) return '';
  const at = dueAt(r);
  let main;
  if (at <= now) main = `Overdue by ${duration(now - at)}`;
  else if (r.pending) main = 'Due now';
  else if (at - now < 12 * HOUR) main = `in ${duration(at - now)}`;
  else main = clockLabel(at, now);
  const rep = REPEAT_WORD[r.repeat];
  return rep ? `${main} · Repeats ${rep}` : main;
}

let ctx = null;

// A short synthesized alert, so no audio files need to ship with the app.
export function playChime(kind = 'chime') {
  if (kind === 'none') return;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    const soft = kind === 'soft';
    const tones = soft ? [[659.25, 0], [523.25, 0.22]] : [[880, 0], [1318.5, 0.18]];
    const peak = soft ? 0.12 : 0.25;
    const length = soft ? 0.9 : 0.7;
    for (const [freq, offset] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = soft ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const start = t0 + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.05);
    }
  } catch { /* no audio device; the system notification still shows */ }
}
