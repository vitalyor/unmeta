// Soft = warn first ("may not work, try?"), hard = refuse. Shared by the app and the stress harness.
// Measured 2026-11-05 (stress test, test/../BRIEF): Redmi Note 10 Pro (6 GB) cleaned 1 GB videos in 80–160 s and
// its tab died on 2.3 GB; Safari on Mac died on 2.3 GB; the cleaned copy lives in memory, plus a transient copy.
const mobile = () => matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const GB = 1024 ** 3;

export function limits() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return { soft: 0.5 * GB, hard: 1.5 * GB }; // ponytail: no real-iPhone measurement yet
  if (mobile()) {
    // Chrome reports deviceMemory coarsely (…, 2, 4, 8); a 6 GB phone reports 4
    const mem = nav.deviceMemory ?? 4;
    const hard = mem >= 8 ? 2 * GB : mem >= 4 ? 1.5 * GB : 0.75 * GB;
    return { soft: hard / 3, hard };
  }
  return { soft: 1 * GB, hard: 2.5 * GB };
}
