// ~270 MB 1080p video with iPhone-style metadata for the opt-in big-file test (not committed).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const dir = new URL('./.big/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '36M',
  '-c:a', 'aac', '-metadata', 'artist=Ivan Petrov', '-metadata', 'location=+55.7558+037.6173/', '-metadata', 'creation_time=2025-05-03T14:35:22Z',
  `${dir}big.mp4`]);
console.log('ok', dir + 'big.mp4');
