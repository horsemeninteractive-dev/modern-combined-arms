/**
 * The in-game changelog.
 *
 * CHANGELOG.md is the single source of truth: Vite inlines the file at build
 * time, so the panel in the menu and the document in the repository can never
 * disagree. Only the small markdown subset the changelog actually uses is
 * rendered here — headings, bullets, bold, inline code and http(s) links — and
 * every piece of text is escaped before any markup is added.
 */
import changelogMarkdown from '../../CHANGELOG.md?raw';
import { escapeHtml } from './modal';

export const CHANGELOG_MARKDOWN: string = changelogMarkdown;

/** Escape first, then decorate, so authored text can never inject markup. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
    );
}

/**
 * Render the changelog body. The document's `# Changelog` title is skipped:
 * the modal owns the heading. The first release gets a LATEST tag.
 */
export function renderChangelog(markdown: string = CHANGELOG_MARKDOWN): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let releases = 0;

  const flushParagraph = () => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) {
      out.push(`<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    }
    list = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      if (level === 1) continue; // The modal title is the document title.
      const body = inline(heading[2]);
      if (level === 2) {
        releases += 1;
        const tag = releases === 1 ? '<em class="changelog-tag">LATEST</em>' : '';
        out.push(`<h2 class="changelog-release">${body}${tag}</h2>`);
      } else {
        out.push(`<h3>${body}</h3>`);
      }
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(inline(bullet[1]));
      continue;
    }

    // Markdown lazy continuation: an unindented line after a bullet belongs to
    // that bullet, which keeps wrapped changelog entries one item.
    if (list.length > 0) {
      list[list.length - 1] += ` ${inline(line)}`;
      continue;
    }
    paragraph.push(inline(line));
  }

  flushParagraph();
  flushList();
  return `<div class="changelog">${out.join('')}</div>`;
}
