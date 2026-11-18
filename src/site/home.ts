import type { CollectionSummary, EraSummary, EventRecord, Person, PersonDetail } from '../types';
import { bannerPicture } from './banner';
import { collectionCategoryName, type SiteLibrary } from './data';
import { escapeHtml } from './escape';
import { collectionFeature, eraSummary, eventDates, eventSummary, eventType, sectionHeading } from './components';
import { icon } from './icons';

function homeCollectionCard(library: SiteLibrary, collection: CollectionSummary): string {
  const category = collectionCategoryName(library, collection.category);
  return `<div class="lt-home-collection-card" data-home-collection-id="${escapeHtml(collection.id)}">${collectionFeature(
    collection,
    {
      className: 'lt-home-collection-item',
      categoryLabel: category,
    },
  )}</div>`;
}

function homeEventCard(event: EventRecord): string {
  return `<li class="lt-home-event-item"><span class="lt-home-event-kind">${eventType(event)}</span>${eventSummary(event, { className: 'lt-home-event-summary', showType: false })}<span class="lt-home-item-arrow" aria-hidden="true">${icon('arrow-up-right')}</span></li>`;
}

function homeEraCard(era: EraSummary): string {
  return `<li class="lt-era-card lt-home-era-card">${eraSummary(era, { className: 'lt-home-era-summary' })}</li>`;
}

function homeState(message: string, retryKey?: string): string {
  return `<div class="lt-home-state" role="status"><p>${escapeHtml(message)}</p>${retryKey ? `<button class="lt-home-retry" type="button" data-retry="${escapeHtml(retryKey)}">重试</button>` : ''}</div>`;
}

function uniquePeople(collections: CollectionSummary[], pathPeople: PersonDetail[]): Array<Person | PersonDetail> {
  const people = [...pathPeople, ...collections.flatMap((collection) => collection.featuredMembers)];
  const seen = new Set<string>();
  return people.filter((person) => {
    if (seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });
}

function homeClosing(collections: CollectionSummary[], pathPeople: PersonDetail[]): string {
  const collection = collections[0];
  const person = pathPeople.find(
    (candidate) => candidate.topics[0]?.id && (candidate.birth !== undefined || candidate.death !== undefined),
  );
  if (!collection || !person) return '';

  const start = person.birth ?? person.death!;
  const end = person.death ?? person.birth!;
  const padding = Math.max(8, Math.round((end - start) * 0.15));
  const topic = person.topics[0].id;
  const timelineUrl = `/timeline?topic=${encodeURIComponent(topic)}&person=${encodeURIComponent(person.id)}&from=${start - padding}&to=${end + padding}`;
  const personName = person.display || person.name;

  return `<section class="lt-home-closing" aria-labelledby="home-path-title"><div><h2 id="home-path-title">从一个人，走进一段历史。</h2><p>沿人物、群像和年表，阅读相互连接的历史。</p></div><nav class="lt-home-path" aria-label="推荐探索路径"><a href="/people/${encodeURIComponent(person.id)}" data-site-link>${escapeHtml(personName)}列传</a><span aria-hidden="true">→</span><a href="/collections/${encodeURIComponent(collection.id)}" data-site-link>${escapeHtml(collection.name)}</a><span aria-hidden="true">→</span><a href="${timelineUrl}" data-timeline-link>在年表中定位 ${icon('arrow-right')}</a></nav></section>`;
}

function homeHeroThread(
  label: string,
  kind: 'person' | 'event' | 'collection',
  id: string | undefined,
  name: string,
  detail: string,
): string {
  const className = `lt-home-hero-thread-node lt-home-hero-thread-node-${kind}`;
  const content = `<small>${escapeHtml(label)}</small><strong>${escapeHtml(name)}</strong><span>${escapeHtml(detail)}</span>`;
  if (!id) return `<span class="${className}">${content}</span>`;
  if (kind === 'collection') {
    return `<a class="${className}" href="/collections/${encodeURIComponent(id)}" data-site-link>${content}</a>`;
  }
  return `<a class="${className}" href="/${kind === 'person' ? 'people' : 'events'}/${encodeURIComponent(id)}" data-entity-kind="${kind}" data-entity-id="${escapeHtml(id)}">${content}</a>`;
}

export function homePage(library: SiteLibrary, pathPeople: PersonDetail[] = []): string {
  const editorial = library.catalog?.editorial ?? { dynasties: [], collections: [], events: [] };
  const erasById = new Map(library.eras.map((era) => [era.id, era]));
  let recommendedEras = editorial.dynasties
    .flatMap((id) => {
      const era = erasById.get(id);
      return era ? [era] : [];
    })
    .slice(0, 4);
  if (recommendedEras.length === 0) {
    recommendedEras = library.eras
      .filter((era): era is EraSummary & { summary: string } => Boolean(era.summary))
      .slice(0, 4);
  }
  const recommendedCollections = editorial.collections.flatMap((id) => {
    const collection = library.collections.find((item) => item.id === id);
    return collection ? [collection] : [];
  });
  const featuredPeople = uniquePeople(recommendedCollections, pathPeople).slice(0, 3);
  const featuredEvents = library.catalog?.homeEvents ?? [];
  const failed = (id: string) => library.failures.includes(id);
  const heroPerson = featuredPeople[0];
  const heroCollection = recommendedCollections[0];
  const heroEvent = featuredEvents[0];

  return `<main id="main-content" class="lt-home">
    <section class="lt-home-hero" aria-labelledby="home-title">
      <div class="lt-home-hero-media">${bannerPicture('home-portraits')}</div>
      <div class="lt-home-hero-shell">
        <div class="lt-home-hero-copy">
          <p class="lt-home-hero-kicker">中国历史 · 交互式档案馆</p>
          <h1 id="home-title" tabindex="-1">纵横千年，人物相望</h1>
          <p class="lt-home-hero-lede">以时间为经，以人物为纬</p>
          <form class="lt-home-search" action="/search" method="get" role="search" data-native-form>
            <label class="sr-only" for="home-query">全站搜索</label>
            <div class="lt-home-search-box">${icon('search')}<input id="home-query" type="search" name="q" placeholder="搜索人物、事件、群像、朝代……" required /><input type="hidden" name="type" value="all" /><button class="lt-home-search-submit" type="submit" aria-label="搜索">${icon('arrow-right')}</button></div>
          </form>
          <a class="lt-home-timeline-link" href="/timeline" data-timeline-link><span>进入年表</span>${icon('arrow-right')}</a>
        </div>
        <nav class="lt-home-hero-threads" aria-label="人物与事件脉络">
          ${homeHeroThread('人物', 'person', heroPerson?.id, heroPerson ? heroPerson.display || heroPerson.name : '人物数据', heroPerson ? '精选人物' : '等待数据')}
          ${homeHeroThread('事件', 'event', heroEvent?.id, heroEvent ? heroEvent.display || heroEvent.name : '事件线', heroEvent ? eventDates(heroEvent) : '等待数据')}
          ${homeHeroThread('群像', 'collection', heroCollection?.id, heroCollection?.name ?? '策展群像', heroCollection ? '编辑精选' : '等待数据')}
        </nav>
      </div>
    </section>
    <div class="lt-home-content">
      <section class="lt-home-featured lt-home-recommendations" aria-labelledby="home-featured-title">
        ${sectionHeading('兰台精选', { id: 'home-featured-title', className: 'lt-home-section-heading', description: '从人物、纪事与断代出发，找到下一段阅读路径。' })}
        <div class="lt-home-featured-grid">
          <section class="lt-home-recommendations lt-home-featured-group" aria-labelledby="home-collections-title">${sectionHeading('精选群像', { id: 'home-collections-title', level: 3, className: 'lt-home-group-heading', href: '/collections', linkLabel: '查看全部' })}${failed('collections') ? homeState('精选群像暂时无法加载。', 'collections') : recommendedCollections.length ? `<div class="lt-home-collection-list">${recommendedCollections.map((collection) => homeCollectionCard(library, collection)).join('')}</div>` : homeState('当前没有编辑精选群像。')}</section>
          <section class="lt-home-recommendations lt-home-featured-group" aria-labelledby="home-events-title">${sectionHeading('本期纪事', { id: 'home-events-title', level: 3, className: 'lt-home-group-heading', href: '/events', linkLabel: '浏览纪事' })}${featuredEvents.length ? `<ul class="lt-home-event-list">${featuredEvents.map(homeEventCard).join('')}</ul>` : homeState('纪事资料尚未载入。')}</section>
          <section class="lt-home-recommendations lt-home-featured-group" aria-labelledby="home-eras-title">${sectionHeading('推荐朝代', { id: 'home-eras-title', level: 3, className: 'lt-home-group-heading', href: '/eras', linkLabel: '浏览断代' })}${failed('eras') ? homeState('推荐朝代暂时无法加载。', 'eras') : recommendedEras.length ? `<ul class="lt-era-recommendations lt-home-era-list">${recommendedEras.map(homeEraCard).join('')}</ul>` : homeState('朝代资料尚未整理。')}</section>
        </div>
      </section>
      ${homeClosing(recommendedCollections, pathPeople)}
    </div>
  </main>`;
}
