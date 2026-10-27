const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#main-nav');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menu?.classList.toggle('open', open);
});

menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', 'Open menu');
  menu.classList.remove('open');
}));

const downloadLink = document.querySelector('#desktop-download-link');
const releaseStatus = document.querySelector('#release-status');
const platform = /Windows/i.test(navigator.userAgent) ? 'windows' : /Macintosh|Mac OS/i.test(navigator.userAgent) ? 'mac' : /Linux/i.test(navigator.userAgent) ? 'linux' : null;
const assetNames = {
  windows: 'Open-Forensic-Setup.exe',
  mac: 'Open-Forensic.dmg',
  linux: 'Open-Forensic.AppImage',
};

async function discoverInstaller() {
  if (!downloadLink || !releaseStatus || !platform) return;
  try {
    const response = await fetch('https://api.github.com/repos/tawandajosephmutsena/OpenForensic/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const release = await response.json();
    const asset = release.assets?.find((item) => item.name === assetNames[platform]);
    if (!asset?.browser_download_url) return;
    downloadLink.href = asset.browser_download_url;
    downloadLink.innerHTML = `Download for ${platform === 'mac' ? 'Mac' : platform === 'windows' ? 'Windows' : 'Linux'} <span aria-hidden="true">↓</span>`;
    releaseStatus.textContent = platform === 'mac'
      ? `${release.name || release.tag_name} · Mac installer is unsigned and may require extra approval.`
      : platform === 'windows'
        ? `${release.name || release.tag_name} · Windows installer is unsigned; your system may ask for confirmation.`
        : `${release.name || release.tag_name} · AppImage download; make the file executable before launch.`;
  } catch {
    // The release page remains available when GitHub's API cannot be reached.
  }
}

discoverInstaller();
