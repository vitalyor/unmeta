<script lang="ts">
  import Icon from '../Icon.svelte';
  import Thumb from '../parts/Thumb.svelte';
  import Modes from '../parts/Modes.svelte';
  import ModeChip from '../parts/ModeChip.svelte';
  import { t, size } from '../i18n.svelte';
  import { app, cleanBatch, saveAll, save, openItem, mobile } from '../store.svelte';
  import { CATEGORIES } from '../../engine';
  let { pick }: { pick: () => void } = $props();
  const phone = mobile();
  const items = $derived(app.items);
  const cleanable = $derived(items.filter((i) => i.status === 'ready' || i.status === 'cleaning' || i.status === 'done'));
  const reading = $derived(items.some((i) => i.status === 'reading'));
  const geo = $derived(items.filter((i) => i.report?.found.location).length);
  const finds = (i: (typeof items)[number]) => CATEGORIES.filter((c) => i.report?.found[c]?.length).length;
  const done = $derived(items.filter((i) => i.status === 'done'));
  const total = $derived(done.reduce((a, i) => a + (i.result?.blob.size ?? 0), 0));
  const skipped = $derived(items.filter((i) => ['unsupported', 'tooLarge'].includes(i.status)).length);
  const failed = $derived(items.filter((i) => i.status === 'error').length);
</script>

{#snippet action()}
  {#if app.batchPhase === 'done'}
    <button type="button" class="btn btn-primary btn-all" onclick={saveAll}><Icon name={phone ? 'share' : 'download'} /><span>{t('actions.downloadAll')}</span></button>
    <span class="all-hint">{t('actions.downloadAllHint')}, {size(total)}</span>
  {:else if app.batchPhase === 'cleaning'}
    <span class="all-progress" aria-live="polite">{t('batch.progress', { done: done.length, total: cleanable.length })}</span>
  {:else}
    <button type="button" class="btn btn-primary btn-clean" disabled={reading || !cleanable.length} onclick={cleanBatch}>
      <Icon name="eraser" /><span>{reading ? t('progress.reading') : t('actions.cleanCount', { count: cleanable.length })}</span></button>
  {/if}
{/snippet}

<section class="screen s-batch phase-{app.batchPhase}">
  <div class="pane pane-file">
    <div class="batch-head">
      <h1 class="sec-title">{app.batchPhase === 'done' ? t('result.done') : t('report.title')}</h1>
      <p class="summary">
        {#if app.batchPhase === 'done'}
          {[t('batch.cleaned', { count: done.length }), skipped && t('batch.skipped', { count: skipped }), failed && t('batch.failed', { count: failed })].filter(Boolean).join('. ')}.
        {:else}
          {[t('batch.files', { count: items.length }), geo && t('batch.withLocation', { count: geo })].filter(Boolean).join('. ')}.
        {/if}
      </p>
    </div>
    <ul class="gallery" role="list">
      {#each items as it, i (it.id)}
        <li class="tile" class:is-skip={['unsupported', 'tooLarge', 'error'].includes(it.status)} style="--i:{i}">
          <div class="tile-img">
            <Thumb {it} />
            {#if it.video && it.url}<span class="play" aria-hidden="true"></span>{/if}
            {#if it.status === 'cleaning' || it.status === 'reading'}<span class="bar"><span class="bar-fill indeterminate"></span></span>{/if}
            {#if it.status === 'done'}
              <button type="button" class="icon-btn" aria-label="{t('actions.download')} {it.file.name}" onclick={() => save(it)}><Icon name={it.saved ? 'check' : phone ? 'share' : 'download'} /></button>
            {/if}
          </div>
          <p class="tile-name">
            {#if it.status === 'ready' || it.status === 'done'}<button type="button" class="tile-open" onclick={() => openItem(i)}>{it.file.name}</button>{:else}{it.file.name}{/if}
          </p>
          <p class="tile-meta">{size(it.file.size)}</p>
          {#if it.status === 'reading'}<p class="tile-st muted">{t('progress.reading')}</p>
          {:else if it.status === 'unsupported'}<p class="tile-st muted"><Icon name="info" />{t('batch.cantClean')}</p>
          {:else if it.status === 'tooLarge'}<p class="tile-st muted"><Icon name="info" />{t('tooLarge.title', { size: size(it.file.size) })}</p>
          {:else if it.status === 'plain' || it.status === 'nothing'}<p class="tile-st muted"><Icon name="check" />{t('batch.nothingHidden')}</p>
          {:else if it.status === 'error'}<p class="tile-st muted"><Icon name="info" />{t('errors.cleanFailed')}</p>
          {:else if it.status === 'done'}<p class="tile-st ok"><Icon name="check" />{t('result.done')}</p>
          {:else if it.report?.found.location}<p class="tile-st geo"><Icon name="location" />{t('batch.hasLocation')} · {t('batch.findings', { count: finds(it) })}</p>
          {:else}<p class="tile-st">{t('batch.findings', { count: finds(it) })}</p>{/if}
        </li>
      {/each}
    </ul>
    <button type="button" class="link-btn add" onclick={pick}><Icon name="plus" />{t('actions.addMore')}</button>
  </div>
  <div class="pane pane-act">
    {#if app.batchPhase === 'found'}<Modes /><ModeChip />{/if}
    <div class="batch-act">{@render action()}</div>
  </div>
  <div class="dock">{#if app.batchPhase === 'found'}<ModeChip />{/if}{@render action()}</div>
</section>
