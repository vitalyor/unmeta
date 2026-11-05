<script lang="ts">
  // Privacy page from copy/privacy.{ru,en}.md, rendered with a tiny Markdown subset (headings, paragraphs, lists, links, bold).
  import ru from '../../../copy/privacy.ru.md?raw';
  import en from '../../../copy/privacy.en.md?raw';
  import { i18n, t } from '../i18n.svelte';
  let { back }: { back: () => void } = $props();
  const REPO = 'https://github.com/vitalyor/unmeta'; // ponytail: real link once the repo is published

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, href) => `<a href="${/^https?:/.test(href) ? href : '#'}" rel="noopener" target="_blank">${txt}</a>`);
  function md(src: string): string {
    const out: string[] = [];
    let list: string[] = [];
    const flush = () => { if (list.length) { out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`); list = []; } };
    for (const block of src.replace(/\{\{REPO_URL\}\}/g, REPO).split(/\n{2,}/)) {
      for (const line of block.split('\n')) {
        const h = line.match(/^(#{1,3})\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
        if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
        else if (li) list.push(li[1]);
        else if (line.trim()) { flush(); out.push(`<p>${inline(line)}</p>`); }
      }
      flush();
    }
    return out.join('');
  }
  const html = $derived(md(i18n.lang === 'ru' ? ru : en));
</script>

<section class="screen s-msg s-privacy">
  <article class="msg prose">{@html html}
    <div class="msg-act"><button type="button" class="btn btn-quiet" onclick={back}><span>{t('actions.close')}</span></button></div>
  </article>
</section>
