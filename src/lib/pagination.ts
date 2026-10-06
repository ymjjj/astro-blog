export const PAGE_SIZE = 6;

export function pageCount(count: number): number {
  return Number.isFinite(count) ? Math.max(1, Math.ceil(Math.max(0, count) / PAGE_SIZE)) : 1;
}

export function pagePath(section: string, number: number): string {
  const normalizedSection = section.replace(/^\/+|\/+$/g, '');
  const page = Number.isFinite(number) ? Math.floor(number) : 1;

  if (!normalizedSection) return page > 1 ? `/page/${page}/` : '/';
  return page > 1 ? `/${normalizedSection}/page/${page}/` : `/${normalizedSection}/`;
}
