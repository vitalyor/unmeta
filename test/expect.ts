import type { Category } from '../src/engine';

// file → categories that MUST be detected before cleaning (browser tests and server tests)
export const EXPECT: Record<string, Category[]> = {
  'photo.jpg': ['location', 'device', 'author', 'software', 'thumbnails', 'dates', 'descriptions'],
  'photo.png': ['location', 'device', 'author', 'software', 'dates', 'descriptions'],
  'photo-big.jpg': ['location', 'device', 'author', 'software', 'dates', 'descriptions'],
  'photo-big.png': ['location', 'device', 'author', 'software', 'dates', 'descriptions'],
  'photo.tif': ['location', 'device', 'author', 'software', 'dates', 'descriptions'],
  'photo.heic': ['location', 'device', 'author', 'software', 'dates', 'descriptions'],
  'photo.gif': ['author'],
  'video.mp4': ['location', 'device', 'author', 'dates'],
  'video.mov': ['location', 'device', 'author', 'dates'],
  'video.mkv': ['author', 'dates', 'descriptions'],
  'video.webm': ['author', 'dates', 'descriptions'],
  'video.avi': ['author', 'descriptions'],
  'audio.mp3': ['author', 'descriptions'],
  'audio.flac': ['author', 'descriptions'],
  'audio.wav': ['author', 'descriptions'],
  'audio.opus': ['author', 'descriptions'],
  'audio.m4a': ['author', 'dates', 'descriptions'],
  'doc.pdf': ['author', 'software', 'dates', 'descriptions'],
  'doc.docx': ['author', 'software', 'dates', 'descriptions'],
  'doc.odt': ['author', 'software', 'dates', 'descriptions'],
};

// Non-Latin values must come through as written (they were shown as "Ð Ð»Ð¸" once)
export const CYRILLIC: Record<string, string> = {
  'photo-cyrillic.jpg': 'Алина Карабер',
  'video-cyrillic.mp4': 'Алина Карабер',
};
