import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from '../site.config';

export type Entry = CollectionEntry<'posts'> | CollectionEntry<'moments'>;
export const url = (path = '') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
export const entryUrl = (entry: Entry) =>
  url(`${entry.collection}/${entry.id.split('/').map(encodeURIComponent).join('/')}/`);
export const tagUrl = (tag: string) => url(`tags/${encodeURIComponent(tag)}/`);
export const formatDate = (date: Date, short = false) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: site.timezone,
    year: short ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
export const yearOf = (date: Date) =>
  new Intl.DateTimeFormat('en', { timeZone: site.timezone, year: 'numeric' }).format(date);
export const plain = (text = '') =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`#*_>$|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export const entryTitle = (entry: Entry) =>
  entry.data.title || `碎碎念 · ${formatDate(entry.data.date)}`;
export const excerpt = (entry: Entry) =>
  entry.collection === 'posts' ? entry.data.description : plain(entry.body).slice(0, 140);
export const readingTime = (entry: Entry) => Math.max(1, Math.ceil(plain(entry.body).length / 400));
const newest = (a: Entry, b: Entry) =>
  b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id);
// 每一个公开出口都使用此函数，缺省 draft=true，显式发布才可见。
export async function published() {
  const [posts, moments] = await Promise.all([
    getCollection('posts', ({ data }) => !data.draft),
    getCollection('moments', ({ data }) => !data.draft),
  ]);
  return {
    posts: posts.sort(newest),
    moments: moments.sort(newest),
    all: [...posts, ...moments].sort(newest),
  };
}
// 只供详情路由和本地草稿列表使用；公共出口始终调用 published()。
export async function readable() {
  if (!__LOCAL_DRAFTS__) return published();
  const [posts, moments] = await Promise.all([getCollection('posts'), getCollection('moments')]);
  return {
    posts: posts.sort(newest),
    moments: moments.sort(newest),
    all: [...posts, ...moments].sort(newest),
  };
}
export function tagsFor(entries: Entry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) =>
    entry.data.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)),
  );
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
}
