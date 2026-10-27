const sectionLinks = [...document.querySelectorAll('.docs-sidebar a[href^="#"], .docs-toc a[href^="#"]')];
const sections = [...document.querySelectorAll('.docs-section[id]')];
if ('IntersectionObserver' in window && sections.length) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    sectionLinks.forEach((link) => {
      const active = link.getAttribute('href') === `#${visible.target.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-120px 0px -55% 0px', threshold: [0, .1, .3, .5] });
  sections.forEach((section) => observer.observe(section));
}
const copyButton = document.querySelector('.copy-code');
copyButton?.addEventListener('click', async () => {
  const code = document.querySelector('.docs-code code')?.textContent;
  if (!code || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(code);
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 1800);
  } catch { copyButton.textContent = 'Copy manually'; }
});
