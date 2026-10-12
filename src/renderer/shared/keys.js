// Shortcut labels as people read them on their own keyboard. The accelerators themselves stay
// CommandOrControl (Electron maps those per platform); only the text shown changes, so the
// labels written in the UI as "Ctrl+N" read "⌘N" on a Mac.

import { t } from './i18n.js';

const platform = (window.stickies && window.stickies.platform) || '';
export const IS_MAC = platform === 'darwin';

// The key that the renderer treats as "the modifier" (ctrlKey || metaKey) is Command on a Mac.
export const MOD_KEY = IS_MAC ? 'Meta' : 'Control';

const MODS = 'CommandOrControl|CmdOrCtrl|Command|Cmd|Ctrl|Control|Alt|Option|AltGr|Shift|Super|Meta';
const CHORD_RE = new RegExp(`\\b((?:(?:${MODS})\\+)+)`, 'g');

// macOS lists modifiers in a fixed order: Control, Option, Shift, Command.
const MAC_SYMBOL = {
  CommandOrControl: '⌘', CmdOrCtrl: '⌘', Command: '⌘', Cmd: '⌘', Ctrl: '⌘', Super: '⌘', Meta: '⌘',
  Control: '⌃', Alt: '⌥', Option: '⌥', AltGr: '⌥', Shift: '⇧'
};
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];

const OTHER_NAME = {
  CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Command: 'Ctrl', Cmd: 'Ctrl', Ctrl: 'Ctrl', Control: 'Ctrl',
  Alt: 'Alt', Option: 'Alt', AltGr: 'AltGr', Shift: 'Shift',
  Super: platform === 'win32' ? 'Win' : 'Super', Meta: platform === 'win32' ? 'Win' : 'Super'
};

// "Ctrl+Shift+P" -> "⇧⌘P" on a Mac, unchanged elsewhere. Works on accelerators
// ("CommandOrControl+Alt+N") and on prose that contains them ("Ctrl+Click to open").
export function keyLabel(text) {
  if (!text) return '';
  return String(text).replace(CHORD_RE, (chord) => {
    const names = chord.split('+').filter(Boolean);
    if (!IS_MAC) return names.map(n => OTHER_NAME[n] || n).join('+') + '+';
    const syms = [...new Set(names.map(n => MAC_SYMBOL[n] || n))];
    return syms.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b)).join('');
  }).replace(/([⌘⌥⇧⌃])Click\b/g, '$1-click');
}

// Words for a hint like "Add Ctrl, Alt or Shift" (a function so it follows the language).
export const modifierHint = () => (IS_MAC ? t('keys.addModifierMac') : t('keys.addModifier'));

// Rewrites shortcut text already in the page: title attributes, menu hints and <kbd> labels.
export function localizeKeys(root = document) {
  if (!IS_MAC) return;
  for (const el of root.querySelectorAll('[title]')) {
    const t = el.getAttribute('title');
    const next = keyLabel(t);
    if (next !== t) el.setAttribute('title', next);
  }
  for (const el of root.querySelectorAll('.hint, kbd')) {
    if (el.children.length) continue;
    const next = keyLabel(el.textContent);
    if (next !== el.textContent) el.textContent = next;
  }
}
