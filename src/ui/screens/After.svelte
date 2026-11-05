<script lang="ts">
  import Icon from '../Icon.svelte';
  import Thumb from '../parts/Thumb.svelte';
  import Finds from '../parts/Finds.svelte';
  import { t } from '../i18n.svelte';
  import { app, item, save, home, mobile, go } from '../store.svelte';
  const it = $derived(item()!);
  const r = $derived(it.result!);
  const phone = mobile();
  // honest notes from the engine: what couldn't be removed (RAW MakerNotes, video keep-limits)
  const leftover = $derived(r.notes.flatMap((n) => (n.startsWith('raw-kept:') ? n.slice(9).split(',') : [])).filter((c) => c !== 'device' && c !== 'thumbnails'));
  const keptByChoice = $derived(Object.keys(r.after.found).length > 0);
  const label = (c: string) => (c === 'serial' ? t('categories.device.name') : t(`categories.${c}.name`));
  const batch = $derived(app.items.length > 1);
</script>

{#snippet getBtn(cls: string)}
  <button type="button" class="btn btn-primary btn-get {cls}" class:is-done={it.saved} onclick={() => save(it)}>
    <Icon name={it.saved ? 'check' : phone ? 'share' : 'download'} />
    <span>{it.saved ? t('actions.saved') : phone ? t('actions.save') : t('actions.download')}</span>
  </button>
{/snippet}

<section class="screen s-after view-{app.view}">
  <div class="pane pane-file">
    <figure class="photo" style="view-transition-name:hero"><Thumb {it} /></figure>
    <p class="file-line"><b>{it.file.name}</b><Icon name="arrow" /><b>{r.name}</b></p>
  </div>
  <div class="pane pane-act">
    <div class="done-head">
      <h1 class="sec-title">{t('result.done')}</h1>
      <p class="summary">{keptByChoice || leftover.length ? t('result.verifiedKept') : t('result.verified')}</p>
    </div>
    {#if leftover.length}
      <p class="msg-tip"><Icon name="info" />{t('result.notFullyClean', { categories: leftover.map(label).join(', ') })}</p>
    {/if}
    <div class="get">
      {@render getBtn('')}
      <p class="get-hint">{phone ? t('actions.saveHint') : t('result.newName', { name: r.name })}</p>
      <p class="get-safe">{t('result.originalSafe')}</p>
    </div>
    <div class="ba" role="tablist" aria-label="{t('result.before')} / {t('result.after')}">
      <button type="button" role="tab" aria-selected={app.view === 'before'} onclick={() => (app.view = 'before')}>{t('result.before')}</button>
      <button type="button" role="tab" aria-selected={app.view === 'after'} onclick={() => (app.view = 'after')}>{t('result.after')}</button>
      <span class="ba-pill" aria-hidden="true"></span>
    </div>
    <div class="card list after-list">
      <Finds {it} phase="after" />
      <p class="kept-always"><Icon name="info" />{t('result.leftover')} {t('report.alwaysKept')}</p>
    </div>
    {#if batch}
      <button type="button" class="btn btn-quiet" onclick={() => go(() => (app.screen = 'batch'), 'back')}><Icon name="arrow" cls="back" /><span>{t('batch.files', { count: app.items.length })}</span></button>
    {:else}
      <button type="button" class="btn btn-quiet" onclick={home}><span>{t('actions.startOver')}</span></button>
    {/if}
  </div>
  <div class="dock">{@render getBtn('btn-block')}</div>
</section>
