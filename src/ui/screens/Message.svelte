<script lang="ts">
  // One card for every "not the usual path" state: unsupported, plain text, nothing found, big / too large, error.
  import Icon from '../Icon.svelte';
  import Thumb from '../parts/Thumb.svelte';
  import { t, size } from '../i18n.svelte';
  import { app, item, home, tryBig, openReport, errorText, limits, mobile, cleanCurrent } from '../store.svelte';
  import { ext } from '../../engine/detect';
  let { pick }: { pick: () => void } = $props();
  const it = $derived(item());
  const pct = $derived(Math.round(app.progress * 100));
  const stage = $derived(app.progress < 0.05 ? 'reading' : app.progress < 0.95 ? 'cleaning' : 'verifying');
</script>

{#snippet head()}
  {#if it}
    <div class="file-head">
      <div class="thumb" style="view-transition-name:hero"><Thumb {it} /></div>
      <div class="file-meta"><div class="file-name">{it.file.name}</div><div class="file-size">{size(it.file.size)}</div></div>
    </div>
  {/if}
{/snippet}

<section class="screen s-msg s-{app.msg}">
  <div class="msg">
    {@render head()}
    {#if app.msg === 'unsupported'}
      <h1 class="sec-title">{t('unsupported.title')}</h1>
      <p class="msg-body">{t('unsupported.body')}</p>
      <p class="msg-meta">{t('unsupported.format', { ext: '.' + (ext(it?.file.name ?? '') || '?') })}</p>
      <p class="msg-tip"><Icon name="info" />{t('unsupported.tip')}</p>
      <div class="msg-act"><button type="button" class="btn btn-primary" onclick={pick}><span>{t('actions.chooseOther')}</span></button>
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.close')}</span></button></div>
    {:else if app.msg === 'plain'}
      <h1 class="sec-title">{t('plainText.title')}</h1>
      <p class="msg-body">{t('plainText.body')}</p>
      <div class="msg-act"><button type="button" class="btn btn-primary" onclick={pick}><span>{t('actions.chooseOther')}</span></button>
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.close')}</span></button></div>
    {:else if app.msg === 'nothing'}
      <h1 class="sec-title">{t('report.nothingFound')}</h1>
      <p class="msg-body">{t('report.nothingFoundHint')}</p>
      <p class="msg-meta">{t('report.alwaysKept')}</p>
      <div class="msg-act"><button type="button" class="btn btn-primary" onclick={pick}><Icon name="plus" /><span>{t('actions.addMore')}</span></button>
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.startOver')}</span></button></div>
    {:else if app.msg === 'big'}
      <h1 class="sec-title">{t('bigFile.title', { size: size(it?.file.size ?? 0) })}</h1>
      <p class="msg-body">{t('bigFile.body')}</p>
      <div class="msg-act"><button type="button" class="btn btn-primary" onclick={tryBig}><span>{t('bigFile.try')}</span></button>
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('bigFile.skip')}</span></button></div>
    {:else if app.msg === 'bigRun'}
      <h1 class="sec-title" aria-live="polite">{t('progress.' + stage)}</h1>
      <div class="big-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} aria-label={t('a11y.progress', { name: it?.file.name ?? '', percent: pct })}>
        <div class="bp-track"><div class="bp-fill" style="--p:{app.progress}"></div></div>
        <div class="bp-nums"><span class="bp-pct">{t('progress.percent', { percent: pct })}</span>
          <span class="bp-left">{t('progress.of', { done: size((it?.file.size ?? 0) * app.progress), total: size(it?.file.size ?? 0) })}</span></div>
      </div>
    {:else if app.msg === 'tooLarge'}
      <h1 class="sec-title">{t('tooLarge.title', { size: size(it?.file.size ?? 0) })}</h1>
      <p class="msg-body">{t('tooLarge.body', { limit: size(limits().hard) })}</p>
      {#if mobile()}<p class="msg-tip"><Icon name="info" />{t('tooLarge.mobileHint')}</p>{/if}
      <div class="msg-act"><button type="button" class="btn btn-primary" onclick={pick}><span>{t('actions.chooseOther')}</span></button>
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.close')}</span></button></div>
    {:else}
      <h1 class="sec-title">{t('errors.title')}</h1>
      <p class="msg-body">{errorText(it?.error)}</p>
      <p class="msg-meta">{t('result.originalSafe')}</p>
      <div class="msg-act">
        {#if it}<button type="button" class="btn btn-primary" onclick={() => (it.report ? cleanCurrent() : openReport(it))}><span>{t('actions.retry')}</span></button>{/if}
        <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.close')}</span></button></div>
    {/if}
  </div>
</section>
