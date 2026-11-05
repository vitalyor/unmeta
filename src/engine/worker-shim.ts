// zeroperl decides "browser" by window+document; inside a Worker both are missing and it takes the
// Node branch (node:fs) and crashes. Fake them before zeroperl loads.
// TODO: send the fix upstream (detect via `typeof importScripts`/WorkerGlobalScope).
const g = self as unknown as Record<string, unknown>;
g.window ??= self;
g.document ??= {};
export {};
