/** Renders a branded HTML email body matching the app's visual identity (see client/src/styles.css). */

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ESCAPE[c]);

/** Shared card shell (brand header + footer) used by every email template. */
function shell(inner: string, settingsUrl?: string): string {
  const settings = settingsUrl
    ? `<p style="max-width:480px;margin:8px auto 0;text-align:center;"><a href="${esc(settingsUrl)}" style="font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#e4572e;text-decoration:underline;">Adjust notification settings</a></p>`
    : '';
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:32px 16px;background:#f5efe4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#fbf8f1;border:1px solid #d8cfbc;border-radius:14px;padding:28px;">
      <div style="margin-bottom:20px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#e4572e;margin-right:8px;"></span>
        <span style="font-family:Georgia,'Iowan Old Style',serif;font-size:17px;font-weight:600;color:#16150f;">Dispatch</span>
        <span style="font-family:ui-monospace,'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8474;margin-left:8px;">for Canvas</span>
      </div>
      ${inner}
    </div>
    <p style="max-width:480px;margin:16px auto 0;padding:0 4px;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8474;text-align:center;">Dispatch for Canvas &middot; read-only, never posts on your behalf</p>
    ${settings}
  </body>
</html>`;
}

export function renderEmailHtml(opts: {
  eyebrow?: string;
  title: string;
  /** A short, prominent stat shown as its own block below the title (e.g. a score) — kept
   *  visually separate from the title so a long assignment name and a grade never blur together. */
  stat?: string;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
  /** Link to the app's notification-preferences page, shown as a small footer link. */
  settingsUrl?: string;
}): string {
  const paragraphs = opts.body.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const bullet = line.startsWith('•');
    return `<p style="margin:0 0 8px;padding-left:${bullet ? '14px' : '0'};color:#4a463b;font-size:14px;line-height:1.6;">${esc(line)}</p>`;
  }).join('');
  // Each block-level div occupies its own line, so the stat badge and the CTA button always
  // stack — the inline-block *inside* each div is just what keeps them shrink-to-fit chips
  // instead of stretching edge to edge.
  const stat = opts.stat
    ? `<div style="margin:2px 0 14px;"><div style="display:inline-block;padding:10px 16px;background:#f5efe4;border:1px solid #d8cfbc;border-radius:10px;font-family:Georgia,'Iowan Old Style',serif;font-size:20px;font-weight:700;color:#16150f;">${esc(opts.stat)}</div></div>`
    : '';
  const cta = opts.ctaUrl
    ? `<div style="margin-top:6px;"><a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:10px 18px;background:#16150f;color:#f5efe4;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">${esc(opts.ctaLabel ?? 'Open')} &rarr;</a></div>`
    : '';
  const inner = `${opts.eyebrow ? `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#e4572e;font-weight:600;margin-bottom:6px;">${esc(opts.eyebrow)}</div>` : ''}
      <h1 style="margin:0 0 12px;font-family:Georgia,'Iowan Old Style',serif;font-size:19px;line-height:1.3;color:#16150f;font-weight:600;">${esc(opts.title)}</h1>
      ${stat}
      ${paragraphs}
      ${cta}`;
  return shell(inner, opts.settingsUrl);
}

/** Renders the daily digest as real stacked list rows instead of a single run-on paragraph —
 *  the plaintext version (built by the caller for push/SMS) loses its own line breaks once
 *  whitespace gets collapsed, so the digest needs its own structured template. */
export function renderDigestEmailHtml(opts: {
  eyebrow?: string;
  title: string;
  upcoming: { name: string; course: string; due: string }[];
  updateGroups: { label: string; items: { course: string; title: string }[] }[];
  ctaUrl: string;
  ctaLabel?: string;
  settingsUrl?: string;
}): string {
  const sectionHeader = (text: string, first: boolean) =>
    `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#e4572e;font-weight:600;margin:${first ? '0' : '22px'} 0 4px;">${esc(text)}</div>`;
  const row = (title: string, meta: string, last: boolean) =>
    `<div style="padding:9px 0;${last ? '' : 'border-bottom:1px solid #ece6d8;'}">
      <div style="font-size:14px;font-weight:600;color:#16150f;line-height:1.4;">${esc(title)}</div>
      ${meta ? `<div style="font-size:12px;color:#8a8474;margin-top:2px;">${esc(meta)}</div>` : ''}
    </div>`;

  let inner = opts.eyebrow
    ? `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#e4572e;font-weight:600;margin-bottom:6px;">${esc(opts.eyebrow)}</div>`
    : '';
  inner += `<h1 style="margin:0 0 18px;font-family:Georgia,'Iowan Old Style',serif;font-size:19px;line-height:1.3;color:#16150f;font-weight:600;">${esc(opts.title)}</h1>`;

  if (opts.upcoming.length) {
    inner += sectionHeader(`Due in the next 48 hours (${opts.upcoming.length})`, true);
    inner += opts.upcoming.map((a, i) => row(a.name, `${a.course}${a.course ? ' · ' : ''}due ${a.due}`, i === opts.upcoming.length - 1 && !opts.updateGroups.length)).join('');
  } else {
    inner += `<p style="margin:0 0 4px;color:#4a463b;font-size:14px;">Nothing due in the next 48 hours.</p>`;
  }

  if (opts.updateGroups.length) {
    inner += sectionHeader(`Since your last digest`, !opts.upcoming.length);
    opts.updateGroups.forEach((g, gi) => {
      inner += `<div style="font-size:11px;font-weight:600;color:#8a8474;text-transform:uppercase;letter-spacing:0.06em;margin:${gi === 0 ? '10px' : '14px'} 0 4px;">${esc(g.label)}</div>`;
      inner += g.items.map((it, i) => row(it.title, it.course, i === g.items.length - 1 && gi === opts.updateGroups.length - 1)).join('');
    });
  }

  inner += `<div style="margin-top:20px;"><a href="${esc(opts.ctaUrl)}" style="display:inline-block;padding:10px 18px;background:#16150f;color:#f5efe4;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">${esc(opts.ctaLabel ?? 'Open')} &rarr;</a></div>`;

  return shell(inner, opts.settingsUrl);
}
