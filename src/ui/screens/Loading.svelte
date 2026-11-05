<script lang="ts">
  // First audio/video file: the video tool (~10 MB) downloads once, with real progress.
  import Thumb from '../parts/Thumb.svelte';
  import { t, size } from '../i18n.svelte';
  import { app, item, home } from '../store.svelte';
  const it = $derived(item());
  const total = $derived(app.loadTotal || 32_232_419);
  const p = $derived(app.loadTotal ? app.loadDone / app.loadTotal : 0);
  const pct = $derived(Math.round(p * 100));
</script>

<section class="screen s-msg s-loading">
  <div class="msg">
    {#if it}
      <div class="file-head"><div class="thumb" style="view-transition-name:hero"><Thumb {it} /></div>
        <div class="file-meta"><div class="file-name">{it.file.name}</div><div class="file-size">{size(it.file.size)}</div></div></div>
    {/if}
    <h1 class="sec-title">{t('progress.loadingTool', { size: size(total) })}</h1>
    <p class="msg-body">{t('progress.loadingToolHint')}</p>
    <div class="big-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} aria-label={t('progress.loadingTool', { size: size(total) })}>
      <div class="bp-track"><div class="bp-fill" style="--p:{p}"></div></div>
      <div class="bp-nums"><span class="bp-pct">{t('progress.percent', { percent: pct })}</span><span class="bp-left">{t('progress.of', { done: size(app.loadDone), total: size(total) })}</span></div>
    </div>
    <div class="msg-act"><button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.cancel')}</span></button></div>
  </div>
</section>
