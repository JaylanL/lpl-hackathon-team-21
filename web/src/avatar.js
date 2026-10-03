// Advisor pictures. Demo advisors are fictional, so they get a generated initials avatar
// instead of a photo of a real person. If an advisor record has a photo_url (e.g. a licensed
// headshot in web/public/advisors/), that photo is shown and the avatar is the fallback.

const PALETTE = ["#1d4e89", "#2a7f62", "#8a3b70", "#b5522b", "#4b5aa6", "#6b5b2e", "#1f6f8b", "#7a3e3e"];

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h;
}

export function initials(name) {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function avatarSvg(name, id) {
  const bg = PALETTE[hash(id || name || "") % PALETTE.length];
  return `<svg class="avatar" viewBox="0 0 48 48" role="img" aria-label="${initials(name)}">
    <circle cx="24" cy="24" r="24" fill="${bg}"/>
    <text x="24" y="24" dy=".35em" text-anchor="middle" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="700">${initials(name)}</text>
  </svg>`;
}

// Returns HTML. `esc` is the caller's HTML-escaping function. Call wirePhotoFallbacks(root) after inserting it.
export function advisorPicture(a, esc) {
  const fallback = avatarSvg(esc(a.name || ""), a.advisor_id);
  if (!a.photo_url) return `<span class="avatar-wrap" aria-hidden="true">${fallback}</span>`;
  return `<span class="avatar-wrap"><img class="avatar" src="${esc(a.photo_url)}" alt="Photo of ${esc(a.name)}" loading="lazy" data-fallback="${esc(fallback)}"></span>`;
}

// If a photo fails to load, swap in the generated avatar.
export function wirePhotoFallbacks(root) {
  root.querySelectorAll("img.avatar[data-fallback]").forEach((img) => {
    const swap = () => { img.parentElement.setAttribute("aria-hidden", "true"); img.outerHTML = img.dataset.fallback; };
    if (img.complete && img.naturalWidth === 0) swap();
    else img.addEventListener("error", swap, { once: true });
  });
}
