<script lang="ts">
  import Icon from '../Icon.svelte';
  import { t } from '../i18n.svelte';
  import { app, MODE_ICON } from '../store.svelte';
</script>

<button type="button" class="mode-chip" aria-expanded={app.modeOpen} aria-label="{t('modes.label')}: {t(`modes.${app.mode}.name`)}" onclick={() => (app.modeOpen = !app.modeOpen)}>
  <Icon name={MODE_ICON[app.mode]} /><span>{t(`modes.${app.mode}.name`)}</span><Icon name="chevron" cls="chev" />
</button>
