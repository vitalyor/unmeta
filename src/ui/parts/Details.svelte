<script lang="ts">
  import Icon from '../Icon.svelte';
  import { t } from '../i18n.svelte';
  import { app } from '../store.svelte';
  import type { Tag } from '../../engine';
  let { tags }: { tags: Tag[] } = $props();
</script>

<details class="tags" bind:open={app.details}>
  <summary>{t('report.details')} <span class="tags-n">{tags.length}</span><Icon name="chevron" /></summary>
  <p class="tags-hint">{t('report.detailsHint')}</p>
  {#if tags.length}
    <table><tbody>
      {#each tags as tg, i (i)}<tr><td class="tg">{tg.group1}</td><td class="tk">{tg.name}</td><td class="tv">{tg.value}</td></tr>{/each}
    </tbody></table>
  {:else}<p class="tags-hint">{t('report.detailsEmpty')}</p>{/if}
</details>
