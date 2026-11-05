<script lang="ts">
  import Icon from '../Icon.svelte';
  import { t } from '../i18n.svelte';
  import { mobile } from '../store.svelte';
  let { pick, pickMedia, demo, privacy }: { pick: () => void; pickMedia: () => void; demo: () => void; privacy: () => void } = $props();
  const rows = ['where', 'phone', 'when', 'author'];
  const phone = mobile();
</script>

<section class="screen s-start">
  <div class="hero">
    <h1 class="hero-title">{t('start.title')}</h1>
    <p class="hero-sub">{t('start.subtitle')}</p>
    <div class="hero-act">
      <button type="button" class="btn btn-primary btn-pick" onclick={phone ? pickMedia : pick}><Icon name="upload" /><span>{phone ? t('start.chooseMedia') : t('start.choose')}</span></button>
      <p class="hint">{phone ? t('start.multipleHintMobile') : t('start.multipleHint')}</p>
    </div>
  </div>
  <div class="stage drop" role="button" tabindex="0" aria-label={t('a11y.dropzone')} onclick={phone ? pickMedia : pick}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (phone ? pickMedia : pick)(); } }}>
    <figure class="photo" style="view-transition-name:hero"><img src="{import.meta.env.BASE_URL}example.jpg" alt="" decoding="async" /></figure>
    <div class="label" aria-hidden="true">
      <div class="label-head"><span class="label-name">IMG_4821.JPG</span><span class="label-note">{t('start.labelNote')}</span></div>
      <dl>
        {#each rows as k, i (k)}<div class="label-row" style="--i:{i}"><dt>{t(`start.example.${k}`)}</dt><dd><span>{t(`start.example.${k}Value`)}</span></dd></div>{/each}
      </dl>
    </div>
  </div>
  <div class="start-extra">
    <p class="privacy-line"><Icon name="lock" /><span>{t('start.privacy')} <a href="#privacy" onclick={(e) => { e.preventDefault(); privacy(); }}>{t('start.privacyLink')}</a></span></p>
    <details class="what"><summary>{t('start.whatIsHidden')}<Icon name="chevron" /></summary><p>{t('start.whatIsHiddenBody')}</p></details>
    {#if phone}<button type="button" class="link-btn pick-files" onclick={pick}><Icon name="upload" cls="inline" />{t('start.chooseDocs')}</button>{/if}
    <button type="button" class="link-btn" onclick={demo}>{t('start.tryExample')}</button>
  </div>
  <div class="dock">
    <button type="button" class="btn btn-primary btn-block" onclick={pickMedia}><Icon name="upload" /><span>{t('start.chooseMedia')}</span></button>
    <p class="hint">{t('start.multipleHintMobile')}</p>
  </div>
</section>
