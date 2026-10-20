/* Shared, dependency-free appearance control for Next.js and the static manual. */
(() => {
  const key = 'valet-theme';
  const themes = [
    ['forest', '原色', '紙與森林', '#f6f5f1', '#203c32', '#963f43'],
    ['light', '純白', '清晰明亮', '#ffffff', '#334155', '#2563eb'],
    ['sepia', '暖紙', '奶油紙・靛藍・磚紅', '#f5f0e4', '#485675', '#a14f42'],
    ['nord', 'Nord', '北境暮色', '#2e3440', '#d8dee9', '#88c0d0'],
    ['dracula', 'Dracula', '紫夜微光', '#282a36', '#f8f8f2', '#bd93f9'],
  ];
  const valid = value => value === 'system' || themes.some(t => t[0] === value);
  const media = matchMedia('(prefers-color-scheme: dark)');
  let choice = 'forest';
  try { const saved = localStorage.getItem(key); if (valid(saved)) choice = saved; } catch {}
  const apply = () => {
    const resolved = choice === 'system' ? (media.matches ? 'nord' : 'forest') : choice;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = ['nord', 'dracula'].includes(resolved) ? 'dark' : 'light';
    window.dispatchEvent(new Event('valet-theme-change'));
  };
  apply();
  media.addEventListener('change', () => { if (choice === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      choice = valid(event.newValue) ? event.newValue : 'forest';
      apply();
    }
  });
  if (customElements.get('valet-theme-picker')) return;
  class ThemePicker extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) {
        window.addEventListener('valet-theme-change', this.sync);
        this.sync();
        return;
      }
      const root = this.attachShadow({ mode: 'open' });
      const palette = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><circle cx="7.5" cy="10" r=".7"/><circle cx="11" cy="6.8" r=".7"/><circle cx="15.5" cy="8" r=".7"/></svg>';
      root.innerHTML = `<link rel="stylesheet" href="/theme-picker.css">
        <button class="launcher" aria-label="選擇外觀主題" aria-haspopup="dialog" aria-expanded="false" popovertarget="appearance">${palette}<span>外觀</span></button>
        <section id="appearance" popover="auto" role="dialog" aria-labelledby="appearance-title">
          <header><div><small>MAKE IT YOURS</small><h2 id="appearance-title">選一種喜歡的色調</h2></div><button class="close" aria-label="關閉外觀選單" popovertarget="appearance" popovertargetaction="hide">×</button></header>
          <div class="options" role="radiogroup" aria-label="主題">
            ${themes.map(([id,name,description,bg,ink,accent]) => `<button class="option" role="radio" aria-checked="false" aria-label="${name}" data-choice="${id}"><span class="swatch" style="--sample-bg:${bg};--sample-ink:${ink};--sample-accent:${accent}" aria-hidden="true"><i></i><b></b><em></em></span><span class="caption"><span>${name}<small>${description}</small></span><span class="check" aria-hidden="true">✓</span></span></button>`).join('')}
            <button class="option system" role="radio" aria-checked="false" aria-label="跟隨系統" data-choice="system"><span class="system-icon" aria-hidden="true">◐</span><span class="caption"><span>跟隨系統<small>隨裝置切換明暗</small></span><span class="check" aria-hidden="true">✓</span></span></button>
          </div><p class="note" aria-live="polite">只套用在你的瀏覽器</p>
        </section>`;
      const buttons = [...root.querySelectorAll('[data-choice]')];
      const launcher = root.querySelector('.launcher');
      const panel = root.querySelector('section');
      const sync = () => buttons.forEach(button => {
        const selected = button.dataset.choice === choice;
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      const select = button => {
        choice = button.dataset.choice;
        apply();
        try { localStorage.setItem(key, choice); root.querySelector('.note').textContent = '已記住你的選擇 · 只套用在這個瀏覽器'; }
        catch { root.querySelector('.note').textContent = '已套用 · 瀏覽器目前無法儲存偏好'; }
      };
      buttons.forEach(button => button.addEventListener('click', () => select(button)));
      root.querySelector('.options').addEventListener('keydown', event => {
        const i = buttons.indexOf(root.activeElement);
        if (i < 0) return;
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        let next;
        if (step) next = (i + step + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        else return;
        event.preventDefault(); buttons[next].focus(); select(buttons[next]);
      });
      panel.addEventListener('toggle', event => {
        launcher.setAttribute('aria-expanded', String(event.newState === 'open'));
        if (event.newState === 'open') buttons.find(b => b.dataset.choice === choice)?.focus();
      });
      // Native popovers handle outside clicks and Escape, including focus restoration.
      this.sync = sync;
      window.addEventListener('valet-theme-change', sync);
      sync();
    }
    disconnectedCallback() { window.removeEventListener('valet-theme-change', this.sync); }
  }
  customElements.define('valet-theme-picker', ThemePicker);
})();
