// ═══════════════════════════════════════════════
// Markdown — rendering with syntax highlighting + LaTeX math
// ═══════════════════════════════════════════════

import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark-dimmed.css';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Configure marked with highlight.js
marked.use(
    markedHighlight({
        langPrefix: 'hljs language-',
        highlight(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch {
                    // fall through
                }
            }
            return hljs.highlightAuto(code).value;
        },
    })
);

marked.setOptions({
    breaks: true,
    gfm: true,
});

// Custom renderer to wrap code blocks with copy button
const renderer = new marked.Renderer();

renderer.code = function ({ text, lang, raw }) {
    const language = lang || 'plaintext';

    // `text` from markedHighlight is already the highlighted HTML.
    // `raw` is the original unescaped code string (for the copy button).
    // We need the raw code for the copy button's data-code attribute.
    // Extract raw code: `raw` contains fenced block markers, strip them.
    const rawCode = raw
        ? raw.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '')
        : '';

    return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span>${escapeHtml(language)}</span>
        <button class="code-copy-btn" data-code="${escapeAttr(rawCode)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy
        </button>
      </div>
      <pre><code class="hljs language-${escapeAttr(language)}">${text}</code></pre>
    </div>
  `;
};

marked.use({ renderer });

// ── KaTeX rendering helpers ──

function renderKatex(latex, displayMode) {
    try {
        return katex.renderToString(latex, {
            displayMode,
            throwOnError: false,
            trust: true,
            strict: false,
        });
    } catch {
        return escapeHtml(latex);
    }
}

/**
 * Pre-process LaTeX math expressions before passing to marked.
 * Replaces $$...$$ (block) and $...$ (inline) with rendered KaTeX HTML,
 * wrapped in unique placeholders so marked won't mangle them.
 */
function preprocessMath(text) {
    const placeholders = [];
    let idx = 0;

    function placeholder(html) {
        const token = `%%MATH_${idx++}%%`;
        placeholders.push({ token, html });
        return token;
    }

    // 1. Block math: $$...$$ (can be multiline)
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
        return placeholder(renderKatex(latex.trim(), true));
    });

    // 2. Block math with \[...\] notation
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => {
        return placeholder(renderKatex(latex.trim(), true));
    });

    // 3. Inline math: $...$ (single line, not greedy)
    text = text.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
        return placeholder(renderKatex(latex.trim(), false));
    });

    // 4. Inline math with \(...\) notation
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => {
        return placeholder(renderKatex(latex.trim(), false));
    });

    return { text, placeholders };
}

function restorePlaceholders(html, placeholders) {
    for (const { token, html: mathHtml } of placeholders) {
        html = html.replace(token, mathHtml);
    }
    return html;
}

/**
 * Render markdown string to HTML, with LaTeX math support.
 */
export function renderMarkdown(text) {
    if (!text) return '';
    const { text: preprocessed, placeholders } = preprocessMath(text);
    const html = marked.parse(preprocessed);
    return restorePlaceholders(html, placeholders);
}

/**
 * Attach copy handlers to all code-copy-btn elements within a container.
 */
export function attachCopyHandlers(container) {
    container.querySelectorAll('.code-copy-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const code = btn.getAttribute('data-code');
            try {
                await navigator.clipboard.writeText(code);
                btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
                    btn.classList.remove('copied');
                }, 2000);
            } catch {
                // Clipboard API may fail in insecure contexts
            }
        });
    });
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
