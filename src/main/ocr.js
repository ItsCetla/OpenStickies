'use strict';

// Text recognition for images using the OCR engine built into Windows (macOS: Vision; Linux: Tesseract)
// (Windows.Media.Ocr), driven through PowerShell so no native modules are needed.
// Results are cached next to each attachment as "<name>.txt", so every image is
// recognized at most once.

const { execFile } = require('child_process');
const fs = require('fs');

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:STICKIES_OCR_FILE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { exit 3 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Lines | ForEach-Object { $_.Text }
`;

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');
const OCR_TYPES = /\.(png|jpg|gif|bmp)$/i; // formats the Windows decoder reads reliably

// macOS: the Vision framework, reached through JavaScript for Automation so no native module or
// helper binary is needed. osascript passes the file path to run() as its first argument.
const MAC_SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0;
  request.usesLanguageCorrection = true;
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), null)) return '';
  const results = request.results;
  const lines = [];
  for (let i = 0; i < results.count; i++) {
    const top = results.objectAtIndex(i).topCandidates(1);
    if (top.count) lines.push(top.objectAtIndex(0).string.js);
  }
  return lines.join('\\n');
}
`;

let queue = Promise.resolve();

function cleanLines(stdout) {
  return String(stdout).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}

function runOcrMac(file) {
  return new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, file], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : cleanLines(stdout)));
  });
}

// Linux has no OCR engine built in; use Tesseract when the user has installed it. A missing
// binary fails with ENOENT and resolves null, so nothing is cached and installing it later works.
function runOcrLinux(file) {
  return new Promise((resolve) => {
    execFile('tesseract', [file, 'stdout'], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : cleanLines(stdout)));
  });
}

function runOcr(file) {
  if (process.platform === 'darwin') return runOcrMac(file);
  if (process.platform === 'linux') return runOcrLinux(file);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED], {
      env: { ...process.env, STICKIES_OCR_FILE: file },
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024
    }, (err, stdout) => {
      if (err) { resolve(null); return; }
      resolve(String(stdout).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
    });
  });
}

// Recognize the text in an attachment file. One OCR process runs at a time.
// Images from private notes pass { cache: false } so their text never lands on disk.
function recognize(file, { cache = true } = {}) {
  if (!['win32', 'darwin', 'linux'].includes(process.platform) || !file || !OCR_TYPES.test(file)) return Promise.resolve('');
  const cacheFile = file + '.txt';
  if (cache) { try { return Promise.resolve(fs.readFileSync(cacheFile, 'utf8')); } catch { /* not cached yet */ } }
  const job = queue.then(async () => {
    const text = await runOcr(file);
    if (cache && text !== null) { try { fs.writeFileSync(cacheFile, text); } catch { /* cache is optional */ } }
    return text || '';
  });
  queue = job.catch(() => '');
  return job;
}

module.exports = { recognize };
