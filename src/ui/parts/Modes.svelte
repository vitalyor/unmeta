<script lang="ts">
  // Mode tiles (2×2) + "what to remove" checkboxes. Desktop: always visible. Phone/tablet: bottom sheet.
  import Icon from '../Icon.svelte';
  import { t } from '../i18n.svelte';
  import { CATEGORIES } from '../../engine';
  import { app, setMode, toggleCat, removeSet, MODE_ICON, type ModeId } from '../store.svelte';
  const MODES: ModeId[] = ['maximum', 'balanced', 'privateOnly', 'custom'];
</script>

<div class="modes" class:is-open={app.modeOpen} role="radiogroup" aria-label={t('modes.label')}>
  <div class="modes-head"><span class="modes-label">{t('modes.label')}</span><span class="modes-note">{t('modes.remembered')}</span></div>
  <div class="mode-list">
    {#each MODES as k (k)}
      <button type="button" role="radio" aria-checked={app.mode === k} class="mode" class:is-on={app.mode === k} onclick={() => setMode(k)}>
        <span class="mode-icon"><Icon name={MODE_ICON[k]} /></span><span class="mode-name">{t(`modes.${k}.name`)}</span>
      </button>
    {/each}
  </div>
  <p class="mode-desc" aria-live="polite">{t(`modes.${app.mode}.for`)}</p>
  <details class="custom-wrap" open={app.mode === 'custom' || app.customOpen} ontoggle={(e) => (app.customOpen = (e.currentTarget as HTMLDetailsElement).open)}>
    <summary>{t('modes.custom.heading')}<Icon name="chevron" /></summary>
    <fieldset class="custom"><legend class="vh">{t('modes.custom.heading')}</legend>
      {#each CATEGORIES as c, i (c)}
        <label class="chk" style="--i:{i}">
          <input type="checkbox" checked={removeSet().includes(c)} onchange={(e) => toggleCat(c, (e.currentTarget as HTMLInputElement).checked)}
            aria-label={t('modes.custom.toggleLabel', { category: t(`categories.${c}.name`) })} />
          <span class="chk-box"><Icon name="check" /></span><Icon name={c} /><span>{t(`categories.${c}.name`)}</span>
        </label>
      {/each}
    </fieldset>
  </details>
</div>
{#if app.modeOpen}<button type="button" class="sheet-scrim" aria-label={t('actions.close')} onclick={() => (app.modeOpen = false)}></button>{/if}
