<script lang="ts">
  import Icon from './ui/Icon.svelte';
  import Start from './ui/screens/Start.svelte';
  import Report from './ui/screens/Report.svelte';
  import After from './ui/screens/After.svelte';
  import Batch from './ui/screens/Batch.svelte';
  import Message from './ui/screens/Message.svelte';
  import Loading from './ui/screens/Loading.svelte';
  import Privacy from './ui/screens/Privacy.svelte';
  import { i18n, setLang, t } from './ui/i18n.svelte';
  import { app, addFiles, home, go } from './ui/store.svelte';
  import { warmUp } from './engine';

  // ---------- theme: system by default; the user's choice is a remembered setting ----------
  let theme = $state(localStorage.getItem('um-theme') ?? '');
  const dark = $derived(theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  $effect(() => { if (theme) document.documentElement.dataset.theme = theme; });
  const toggleTheme = () => { theme = dark ? 'light' : 'dark'; localStorage.setItem('um-theme', theme); };
  $effect(() => { document.documentElement.lang = i18n.lang; document.title = t('meta.title'); });

  // ---------- pickers: phones get the system photo picker for the main button (multi-select by tap) ----------
  let anyInput: HTMLInputElement, mediaInput: HTMLInputElement;
  const onPicked = (e: Event) => { const i = e.currentTarget as HTMLInputElement; addFiles([...(i.files ?? [])]); i.value = ''; };

  // ---------- drag & drop, folders included ----------
  let dragging = $state(false), dragN = 0;
  async function entryFiles(entry: FileSystemEntry): Promise<File[]> {
    if (entry.isFile) return [await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))];
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const all: FileSystemEntry[] = [];
    for (;;) { // readEntries returns batches of ~100
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break; all.push(...batch);
    }
    return (await Promise.all(all.filter((e) => !e.name.startsWith('.')).map(entryFiles))).flat();
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault(); dragN = 0; dragging = false;
    const items = [...(e.dataTransfer?.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    try {
      addFiles(items.length ? (await Promise.all(items.map(entryFiles))).flat() : [...(e.dataTransfer?.files ?? [])]);
    } catch { addFiles([...(e.dataTransfer?.files ?? [])]); }
  }

  async function demo() {
    const blob = await (await fetch('/example.jpg')).blob();
    addFiles([new File([blob], 'IMG_4821.JPG', { type: 'image/jpeg' })]);
  }
  const showPrivacy = () => go(() => { app.screen = 'privacy'; });

  // start fetching/compiling the photo engine once the page has painted
  $effect(() => { const id = requestIdleCallback?.(() => warmUp()) ?? setTimeout(warmUp, 800); return () => cancelIdleCallback?.(id as number); });

  // body classes the stylesheet keys its motion on (as in the mockups)
  $effect(() => {
    const b = document.body.classList;
    b.add('intro');
    b.toggle('dragging', dragging); b.toggle('cleaning', app.cleaning); b.toggle('erasing', app.erasing);
    document.documentElement.style.setProperty('--clean-p', String(app.progress));
  });

  // toast
  let toastShow = $state(false);
  $effect(() => { if (!app.toastKey) return; toastShow = true; const id = setTimeout(() => (toastShow = false), 3200); return () => clearTimeout(id); });
</script>

<svelte:window
  ondragenter={(e) => { e.preventDefault(); dragN++; dragging = true; }}
  ondragleave={() => { if (--dragN <= 0) { dragN = 0; dragging = false; } }}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  onkeydown={(e) => { if (e.key === 'Escape' && app.modeOpen) app.modeOpen = false; }} />
<div id="app">
  <header class="top">
    <a class="brand" href="/" aria-label="Unmeta" onclick={(e) => { e.preventDefault(); home(); }}><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Unmeta</span></a>
    <div class="top-tools">
      <button type="button" class="tool" aria-label="{t('settings.language')}: {i18n.lang === 'ru' ? 'English' : 'Русский'}" onclick={() => setLang(i18n.lang === 'ru' ? 'en' : 'ru')}><span>{i18n.lang === 'ru' ? 'EN' : 'RU'}</span></button>
      <button type="button" class="tool" aria-label={t('settings.theme')} onclick={toggleTheme}><Icon name={dark ? 'sun' : 'moon'} /></button>
    </div>
  </header>

  <main id="main">
    {#if app.screen === 'start'}<Start pick={() => anyInput.click()} pickMedia={() => mediaInput.click()} {demo} privacy={showPrivacy} />
    {:else if app.screen === 'loading'}<Loading />
    {:else if app.screen === 'report'}<Report />
    {:else if app.screen === 'after'}<After />
    {:else if app.screen === 'batch'}<Batch pick={() => anyInput.click()} />
    {:else if app.screen === 'privacy'}<Privacy back={home} />
    {:else}<Message pick={() => anyInput.click()} />{/if}
  </main>

  <footer class="foot">
    <span class="foot-promise"><Icon name="lock" />{t('footer.promise')}</span>
    <span class="foot-links"><a href="#privacy" onclick={(e) => { e.preventDefault(); showPrivacy(); }}>{t('footer.privacy')}</a><a href="https://github.com/vitalyor/unmeta" rel="noopener" target="_blank">{t('footer.source')}</a><span class="foot-lic">{t('footer.license')}</span></span>
  </footer>
  <div class="toast" class:show={toastShow} role="status" aria-live="polite">{app.toast}</div>
</div>

<input bind:this={anyInput} type="file" multiple hidden onchange={onPicked} />
<input bind:this={mediaInput} type="file" multiple hidden accept="image/*,video/*" onchange={onPicked} />
