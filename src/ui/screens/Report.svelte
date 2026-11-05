<script lang="ts">
  import Icon from '../Icon.svelte';
  import Thumb from '../parts/Thumb.svelte';
  import Finds from '../parts/Finds.svelte';
  import Details from '../parts/Details.svelte';
  import Modes from '../parts/Modes.svelte';
  import ModeChip from '../parts/ModeChip.svelte';
  import { t, size } from '../i18n.svelte';
  import { app, item, cleanCurrent, home } from '../store.svelte';
  import { CATEGORIES } from '../../engine';
  const it = $derived(item()!);
  const count = $derived(CATEGORIES.filter((c) => it.report?.found[c]?.length).length);
</script>

{#snippet cleanBtn(cls: string)}
  <button type="button" class="btn btn-primary btn-clean {cls}" class:is-busy={app.cleaning} aria-busy={app.cleaning} disabled={app.cleaning} onclick={cleanCurrent}><Icon name="eraser" /><span>{t('actions.clean')}</span></button>
{/snippet}

{#if it}
<section class="screen s-report">
  <div class="pane pane-file">
    <figure class="photo" style="view-transition-name:hero"><Thumb {it} /></figure>
    <p class="file-line"><b>{it.file.name}</b>{size(it.file.size)}</p>
  </div>
  <div class="pane pane-act">
    <h1 class="sec-title">{t('report.title')}</h1>
    <p class="summary">{t('report.summary', { count })}</p>
    <Modes />
    <div class="act-row"><ModeChip />{@render cleanBtn('')}</div>
    <button type="button" class="link-btn other-file" onclick={home} disabled={app.cleaning}><Icon name="x" cls="inline" />{t('actions.chooseOther')}</button>
    <div class="card list">
      <Finds {it} phase="report" />
      <p class="kept-always"><Icon name="info" />{t('report.alwaysKept')}</p>
      <Details tags={it.report?.tags ?? []} />
    </div>
  </div>
  <div class="dock"><ModeChip />{@render cleanBtn('')}</div>
</section>
{/if}
