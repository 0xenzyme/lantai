import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { openSiteUrl } from '../site/context';
import { ICON_PATHS, type IconId } from '../site/icons';

export type SiteSection = 'home' | 'timeline' | 'people' | 'collections' | 'events' | 'eras' | 'search' | 'other';

interface NavigationContext {
  section: SiteSection;
  query?: string;
}

const NAV_ITEMS: Array<readonly [SiteSection, string, string, IconId]> = [
  ['home', '/', '首页', 'home'],
  ['timeline', '/timeline', '年表', 'timeline'],
  ['people', '/people', '列传', 'people'],
  ['collections', '/collections', '群像', 'collections'],
  ['events', '/events', '纪事', 'events'],
  ['eras', '/eras', '断代', 'eras'],
];

type DialogId = 'help';

export function Icon({ id, className = '' }: { id: IconId; className?: string }) {
  return (
    <svg
      className={`lt-icon${className ? ` ${className}` : ''}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[id] }}
    />
  );
}

export function SiteHeader({ section, query = '' }: NavigationContext) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const helpDialogRef = useRef<HTMLDialogElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const lastSectionRef = useRef<SiteSection>(section);

  useEffect(() => {
    if (lastSectionRef.current === section) return;
    lastSectionRef.current = section;
    setMenuOpen(false);
  }, [section]);

  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    (menu?.querySelector<HTMLElement>('a[aria-current="page"]') ?? menu?.querySelector<HTMLElement>('a'))?.focus();
  }, [menuOpen]);

  useEffect(() => {
    const element = dialog === 'help' ? helpDialogRef.current : null;
    for (const candidate of [helpDialogRef.current]) {
      if (!candidate) continue;
      if (candidate === element && !candidate.open) candidate.showModal();
      if (candidate !== element && candidate.open) candidate.close();
    }
    if (element) element.querySelector<HTMLElement>('[data-dialog-close]')?.focus();
    else if (dialogTriggerRef.current) {
      dialogTriggerRef.current.focus();
      dialogTriggerRef.current = null;
    }
  }, [dialog]);

  const openDialog = (id: DialogId, trigger: HTMLElement) => {
    dialogTriggerRef.current = trigger;
    setDialog(id);
  };

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) menuToggleRef.current?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!menuOpen || dialog) return;
    const controls = [...(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])];
    const first = menuToggleRef.current;
    const last = controls.at(-1);
    if (event.key === 'Tab' && first && last) {
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu(true);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams({ q: String(data.get('q') ?? ''), type: 'all' });
    openSiteUrl(`/search?${params.toString()}`);
  };

  const focusHomeSearch = () => {
    const input = document.getElementById('home-query');
    if (!(input instanceof HTMLInputElement)) return;
    input.scrollIntoView({ block: 'center', behavior: 'instant' });
    input.focus({ preventScroll: true });
  };

  const linkProps = (id: SiteSection, href: string) => ({
    href,
    ...(id === 'timeline' ? { 'data-timeline-link': true } : { 'data-site-link': true }),
    ...(section === id ? { 'aria-current': 'page' as const } : {}),
  });

  return (
    <>
      <a className="lt-skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="lt-site-header" onKeyDown={onMenuKeyDown}>
        <a className="lt-brand" href="/" data-site-link aria-label="兰台首页">
          <span className="lt-brand-seal" aria-hidden="true">
            蘭
          </span>
          <span>
            兰台 <small>Lantai</small>
          </span>
        </a>
        <span className="lt-brand-tagline">纵横千年，人物相望</span>
        <nav className="lt-main-nav" aria-label="主导航">
          {NAV_ITEMS.map(([id, href, label, iconId]) => (
            <a key={id} {...linkProps(id, href)}>
              <Icon id={iconId} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        {section === 'home' ? (
          <button
            className="lt-icon-button lt-header-search-home"
            type="button"
            aria-label="全站搜索"
            aria-controls="home-query"
            onClick={focusHomeSearch}
          >
            <Icon id="search" />
          </button>
        ) : (
          <form className="lt-global-search" action="/search" method="get" role="search" onSubmit={submitSearch}>
            <label htmlFor="lt-global-query">全站搜索</label>
            <div className="lt-global-search-box">
              <button className="lt-global-search-submit" type="submit" aria-label="搜索">
                <Icon id="search" />
              </button>
              <input
                key={`${section}:${query}`}
                id="lt-global-query"
                name="q"
                type="search"
                defaultValue={query}
                placeholder="搜索人物、事件、群像、朝代……"
                required
              />
              <input type="hidden" name="type" value="all" />
            </div>
          </form>
        )}
        <button
          ref={menuToggleRef}
          className="lt-menu-toggle"
          type="button"
          data-site-menu
          aria-expanded={menuOpen}
          aria-controls="lt-site-menu"
          onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
        >
          栏目
        </button>
        <div className="lt-header-tools">
          <button
            className="lt-icon-button"
            type="button"
            data-help-open
            aria-haspopup="dialog"
            aria-label="操作说明"
            onClick={(event) => openDialog('help', event.currentTarget)}
          >
            <Icon id="help" />
          </button>
          <a
            className="lt-icon-button"
            href="https://github.com/0xenzyme/lantai"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="GitHub 仓库"
          >
            <Icon id="github" />
          </a>
        </div>
      </header>
      <nav
        ref={menuRef}
        className="lt-site-menu"
        id="lt-site-menu"
        aria-label="全部栏目"
        hidden={!menuOpen}
        onKeyDown={onMenuKeyDown}
      >
        {NAV_ITEMS.map(([id, href, label]) => (
          <a key={id} {...linkProps(id, href)}>
            {label}
          </a>
        ))}
        <button
          type="button"
          data-help-open
          aria-haspopup="dialog"
          onClick={(event) => openDialog('help', event.currentTarget)}
        >
          操作说明
        </button>
        <a href="https://github.com/0xenzyme/lantai" target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
      </nav>
      <dialog
        ref={helpDialogRef}
        className="lt-header-dialog"
        data-help-dialog
        aria-labelledby="lt-help-title"
        onCancel={(event) => {
          event.preventDefault();
          setDialog(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setDialog(null);
        }}
      >
        <div className="lt-header-dialog-head">
          <h2 id="lt-help-title">操作说明</h2>
          <button
            className="lt-icon-button"
            type="button"
            data-dialog-close
            aria-label="关闭操作说明"
            onClick={() => setDialog(null)}
          >
            ×
          </button>
        </div>
        <h3>年表</h3>
        <ul>
          <li>滚轮缩放时间窗，拖动平移；点击人物或事件查看预览。</li>
          <li>底部朝代带可按年代跳转；底部王朝轨切换朝代与主题。</li>
          <li>键盘：画布聚焦后，左右方向键平移，加号减号缩放。</li>
          <li>「分类」选择显示的泳道与事件类型；「导出」保存 PNG 或 SVG。</li>
        </ul>
        <h3>全站</h3>
        <ul>
          <li>全站搜索覆盖人物、事件、群像和朝代，输入关键词后回车或点击搜索按钮。</li>
          <li>人物与事件详情页的「在年表中查看」回到对应时间窗。</li>
          <li>目录页筛选与排序写入地址栏，可直接分享链接。</li>
        </ul>
      </dialog>
    </>
  );
}
