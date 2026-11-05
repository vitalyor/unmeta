<script lang="ts">
  // What we found, one row per category: plain sentence + the value under a marker + why it matters.
  import Icon from '../Icon.svelte';
  import { t } from '../i18n.svelte';
  import { CATEGORIES, type Category } from '../../engine';
  import { removeSet, type Item } from '../store.svelte';
  let { it, phase }: { it: Item; phase: 'report' | 'after' } = $props();

  const report = $derived(phase === 'after' && it.result ? it.result.before : it.report);
  const rm = $derived(phase === 'after' && it.result ? removedCats(it) : removeSet());
  function removedCats(i: Item): Category[] {
    // after cleaning: removed = present before and gone after (what really happened, not what was asked)
    const r = i.result!;
    return CATEGORIES.filter((c) => r.before.found[c] && !r.after.found[c]);
  }
  // Location is never shown as numbers here (they're in the detailed list only).
  const value = (c: Category): string => {
    if (c === 'location' || c === 'thumbnails' || c === 'c2pa') return '';
    const vals = [...new Set((report?.found[c] ?? []).map((tg) => tg.value.replace(/\s*\((image|file)\d*\.\w+\)$/, '')).filter((v) => v && v !== '(binary)'))];
    return vals.slice(0, 2).join(' · ');
  };
  const cats = $derived(CATEGORIES.filter((c) => report?.found[c]?.length));
  let list: HTMLUListElement | undefined = $state();
  // the marker is one scaled bar for one-line values; wrapped values get a plain background instead
  $effect(() => {
    void cats; void phase;
    list?.querySelectorAll<HTMLElement>('.find-ev').forEach((el) => {
      const v = el.querySelector('.ev-val');
      el.classList.toggle('wrap', !!v && v.getClientRects().length > 1);
    });
  });
</script>

<ul class="finds" role="list" bind:this={list}>
  {#each cats as c, i (c)}
    {@const remove = rm.includes(c)}
    {@const ev = value(c)}
    <li class="find {remove ? 'is-remove' : 'is-keep'} cat-{c}" style="--i:{i}" data-cat={c}>
      <span class="find-icon"><Icon name={c} cls="ic-cat" />{#if phase === 'after' && remove}<Icon name="check" cls="ic-done" />{/if}</span>
      <span class="find-body">
        <span class="find-text">{phase === 'after' ? t(`categories.${c}.name`) : t(`categories.${c}.found`, { state: remove ? 'remove' : 'keep' })}</span>
        {#if ev}<span class="find-ev"><span class="ev-val">{ev}</span></span>{/if}
        <span class="find-why">{t(`categories.${c}.why`)}</span>
      </span>
      <span class="find-state" aria-hidden="true">
        {#if phase === 'after'}{#if remove}<Icon name="check" />{/if}<span>{remove ? t('result.removed') : t('result.kept')}</span>{/if}
      </span>
    </li>
  {/each}
</ul>
