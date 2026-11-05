<script lang="ts">
  // Preview built on the device (object URL); never leaves it. Falls back to a file-type drawing.
  import type { Item } from '../store.svelte';
  let { it }: { it?: Item } = $props();
  let broken = $state(false);
  const glyph = $derived(
    !it ? '' : it.kind === 'pdf' ? 'PDF' : it.kind === 'office' ? 'DOC' : it.kind === 'text' ? 'TXT' : it.kind === 'raw' ? 'RAW' : it.kind === 'svg' ? 'SVG' : it.kind === 'unsupported' ? '?' : '',
  );
</script>

{#if it?.url && !broken && it.video}
  <video class="thumb-art thumb-img" src="{it.url}#t=0.1" muted playsinline preload="metadata" onerror={() => (broken = true)}></video>
{:else if it?.url && !broken}
  <img class="thumb-art thumb-img" src={it.url} alt="" decoding="async" onerror={() => (broken = true)} />
{:else if it?.kind === 'av' && !it.video}
  <svg class="thumb-art thumb-file" viewBox="0 0 120 90" aria-hidden="true"><rect width="120" height="90" class="tf-bg" />
    {#each [14, 28, 18, 40, 24, 34, 12, 30, 20] as h, i}<rect x={22 + i * 9} y={45 - h / 2} width="4" height={h} rx="2" class="tf-ink" />{/each}</svg>
{:else}
  <svg class="thumb-art thumb-file" viewBox="0 0 120 90" aria-hidden="true"><rect width="120" height="90" class="tf-bg" />
    <path d="M44 14h24l12 12v50H44z" class="tf-page" /><path d="M68 14v12h12" class="tf-fold" />
    <text x="62" y="60" text-anchor="middle" class="tf-ink tf-text">{glyph}</text></svg>
{/if}
