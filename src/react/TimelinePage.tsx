import { useEffect, useRef } from 'react';
import { SiteHeader } from './SiteHeader';

export function TimelinePage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const controller = new AbortController();
    void import('../app/app').then(({ boot }) => boot(root, controller.signal));
    return () => {
      controller.abort();
      document.body.classList.remove('timeline-app', 'timeline-legacy', 'strip-open');
    };
  }, []);

  return (
    <div id="timeline-root" ref={rootRef}>
      <div id="nebula" aria-hidden="true" />
      <canvas id="stars" aria-hidden="true" />
      <div className="boot" id="boot">
        正在载入数据…
      </div>
      <div className="boot is-error" id="boot-error" hidden />
      <div id="site-header-mount" data-timeline-only>
        <SiteHeader section="timeline" />
      </div>
      <header className="lt-timeline-hero" data-timeline-only>
        <img
          className="lt-page-banner-art"
          src="/media/banners/banner-timeline-1440.webp"
          srcSet="/media/banners/banner-timeline-768.webp 768w, /media/banners/banner-timeline-1440.webp 1440w, /media/banners/banner-timeline-2000.webp 2000w"
          sizes="100vw"
          width="2400"
          height="800"
          alt=""
          aria-hidden="true"
          fetchPriority="high"
          decoding="async"
        />
        <div className="lt-timeline-hero-inner">
          <div className="lt-timeline-hero-text">
            <h1>年表</h1>
            <p>中国历史年表 · 以人物、战事、事件贯通时代脉络</p>
          </div>
          <div className="lt-timeline-hero-actions">
            <button type="button" className="lt-hero-button" data-export="png">
              导出 PNG
            </button>
            <button type="button" className="lt-hero-button" data-export="svg">
              导出 SVG
            </button>
          </div>
        </div>
      </header>
      <a className="lt-skip-link" href="#timeline-tools" data-timeline-only>
        跳到年表工具
      </a>
      <div className="lt-workspace" data-timeline-only>
        <aside className="lt-timeline-filters" id="lane-panel" aria-label="年表分类与筛选">
          <div id="timeline-tools">
            <div className="search lt-timeline-search" id="timeline-search-box">
              <label className="sr-only" htmlFor="search">
                搜索人物或事件
              </label>
              <input
                className="search-input"
                id="search"
                type="search"
                placeholder="搜索当前年表…"
                autoComplete="off"
                role="combobox"
                aria-expanded="false"
                aria-controls="search-results"
              />
              <div className="search-results" id="search-results" role="listbox" aria-label="搜索结果" hidden />
            </div>
            <section className="lt-filter-group" aria-labelledby="filter-groups-title">
              <h2 id="filter-groups-title">分类</h2>
              <label className="lt-filter-check">
                <input type="checkbox" data-group="people" defaultChecked /> <span>人物</span>
                <span className="lt-filter-count" data-group-count="people" />
              </label>
              <label className="lt-filter-check">
                <input type="checkbox" data-group="war" defaultChecked /> <span>战事</span>
                <span className="lt-filter-count" data-group-count="war" />
              </label>
              <label className="lt-filter-check">
                <input type="checkbox" data-group="history" defaultChecked /> <span>历史事件</span>
                <span className="lt-filter-count" data-group-count="history" />
              </label>
            </section>
            <section className="lt-filter-group" aria-labelledby="filter-lanes-title">
              <h2 id="filter-lanes-title">显示分类</h2>
              <div className="lane-panel-head">
                <button type="button" id="lanes-all">
                  全选
                </button>
                <button type="button" id="lanes-none">
                  清空
                </button>
              </div>
              <div id="lane-list" />
            </section>
            <div className="chips lt-filter-group" id="chips" role="group" aria-label="快捷筛选">
              <h2>快捷筛选</h2>
              <div className="lt-chip-row">
                <button type="button" className="chip on" data-filter="all" title="显示全部条目">
                  全部
                </button>
                <button type="button" className="chip" data-filter="military" title="只高亮战事类事件">
                  战事
                </button>
                <button type="button" className="chip" data-filter="political" title="只高亮朝政类事件">
                  朝政
                </button>
                <button type="button" className="chip" data-filter="cultural" title="只高亮文化类事件">
                  文化
                </button>
                <button type="button" className="chip" data-filter="female" title="只高亮女性人物（仅人物线可用）">
                  女性
                </button>
              </div>
            </div>
            <div id="lane-chapters" />
            <label className="lt-topic-select-label" htmlFor="topic-select">
              朝代 / 主题
            </label>
            <select className="topic-select" id="topic-select" title="选择要浏览的朝代或主题" />
            <button type="button" className="lt-filter-reset" id="btn-reset-filters">
              重置筛选
            </button>
          </div>
        </aside>
        <main id="main-content" className="lt-timeline-center">
          <div className="lt-dynasty-head">
            <button
              type="button"
              className="lt-filter-toggle"
              id="btn-filter-toggle"
              aria-label="打开分类与筛选"
              aria-controls="lane-panel"
              aria-expanded="false"
            >
              筛选
            </button>
            <button type="button" className="lt-dynasty-arrow" id="topic-prev" aria-label="上一个专题">
              ‹
            </button>
            <div className="lt-dynasty-head-text" id="topic-head" aria-live="polite" />
            <button type="button" className="lt-dynasty-arrow" id="topic-next" aria-label="下一个专题">
              ›
            </button>
          </div>
          <div id="stage">
            <canvas
              id="chart"
              tabIndex={0}
              role="img"
              aria-label="历史时间轴。使用左右方向键平移，加减键缩放；也可打开当前时间窗实体列表选择对象。"
              aria-describedby="timeline-description"
            />
          </div>
          <div className="lt-timeline-statusbar">
            <div className="lt-legend" aria-label="图例">
              <span className="lt-legend-item">
                <i className="lt-legend-life" />
                人物生平
              </span>
              <span className="lt-legend-item">
                <i className="lt-legend-war" />
                战事
              </span>
              <span className="lt-legend-item">
                <i className="lt-legend-history" />
                历史事件
              </span>
            </div>
            <p className="hint" id="hint">
              滚轮缩放 · 拖动平移 · 点击人物或事件
            </p>
            <details
              className="timeline-accessible-entities"
              id="timeline-accessible-entities"
              aria-label="当前时间窗实体"
            >
              <summary>实体列表</summary>
              <ul id="timeline-entity-list" />
            </details>
            <div className="lt-zoom" role="group" aria-label="视图控制">
              <button type="button" className="tool" id="btn-reset" title="回到当前视图的全览位置">
                复位
              </button>
              <button type="button" className="tool" id="zoom-out" aria-label="缩小">
                −
              </button>
              <span className="lt-zoom-level" id="zoom-level" aria-live="off">
                100%
              </span>
              <button type="button" className="tool" id="zoom-in" aria-label="放大">
                +
              </button>
            </div>
          </div>
        </main>
        <aside className="card lt-timeline-detail" id="card" aria-live="polite" aria-label="详情">
          <button type="button" className="card-close" id="card-close" aria-label="关闭详情">
            ×
          </button>
          <div id="card-body" />
          <div id="card-actions" />
          <p className="lt-detail-empty" id="detail-empty">
            选择人物或事件，在这里查看预览。
          </p>
        </aside>
      </div>
      <nav className="lt-dynasty-band" id="dynasty-band" data-timeline-only aria-label="朝代导航">
        <button type="button" className="lt-dynasty-arrow" id="dynasty-prev" aria-label="向左滚动朝代">
          ‹
        </button>
        <div className="lt-dynasty-track" id="dynasty-track" />
        <button type="button" className="lt-dynasty-arrow" id="dynasty-next" aria-label="向右滚动朝代">
          ›
        </button>
      </nav>
      <p className="sr-only" id="timeline-description" data-timeline-only>
        人物与事件共用时间坐标。当前时间窗实体列表提供不依赖指针的选择入口。
      </p>
      <div className="lt-legacy-controls" data-timeline-only hidden aria-hidden="true">
        <header className="topbar" id="topbar">
          <nav className="line-tabs" aria-label="内容线">
            <button type="button" className="line-btn active" data-line="people">
              人物
            </button>
            <button type="button" className="line-btn" data-line="military">
              军事
            </button>
            <button type="button" className="line-btn" data-line="history">
              历史事件
            </button>
          </nav>
          <button type="button" className="tool" id="btn-lanes">
            分类
          </button>
          <button type="button" className="tool" id="btn-export">
            导出
          </button>
          <div className="export-menu" id="export-menu" hidden>
            <button type="button" data-export="png">
              导出 PNG
            </button>
            <button type="button" data-export="svg">
              导出 SVG
            </button>
          </div>
        </header>
        <button type="button" className="strip-toggle" id="strip-toggle" aria-expanded="false">
          事件条 ▾
        </button>
        <div className="ribbon">
          <canvas id="ribbon-canvas" aria-hidden="true" />
        </div>
      </div>
      <div className="tooltip" id="tooltip" data-timeline-only role="status" hidden />
      <div className="sr-only" id="status" aria-live="polite" aria-atomic="true" />
    </div>
  );
}
