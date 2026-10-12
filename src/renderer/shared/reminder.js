// Reminder helpers shared by note windows and the notes list, so both agree on the
// countdown wording, the urgency thresholds and the alert sound.

import { t, lang } from './i18n.js';

const HOUR = 3600 * 1000;
const REPEATS = new Set(['daily', 'weekdays', 'weekly', 'monthly']);

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
  if (mins < 60) return t('time.minutes', { m: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? t('time.hoursMinutes', { h, m }) : t('time.hours', { h });
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? t('time.daysHours', { d, h: rh }) : t('time.days', { d });
}

function clockLabel(t, now) {
  const d = new Date(t);
  const time = d.toLocaleTimeString(lang(), { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return t('reminder.today', { time });
  if (new Date(now + 86400000).toDateString() === d.toDateString()) return t('reminder.tomorrow', { time });
  return d.toLocaleDateString(lang(), { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}

// "in 2h 15m", "Tomorrow 9:00", "Overdue by 3h", plus "Repeats daily" for repeating ones.
export function relativeLabel(r, now = Date.now()) {
  if (!r) return '';
  const at = dueAt(r);
  let main;
  if (at <= now) main = t('reminder.overdueBy', { duration: duration(now - at) });
  else if (r.pending) main = t('reminder.dueNow');
  else if (at - now < 12 * HOUR) main = t('reminder.inDuration', { duration: duration(at - now) });
  else main = clockLabel(at, now);
  return REPEATS.has(r.repeat) ? t('reminder.withRepeat', { when: main, repeat: t('reminder.' + r.repeat) }) : main;
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
