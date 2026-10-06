import { published, entryUrl, entryTitle, excerpt, plain, formatDate } from '../lib/content';
export async function GET() {
  const { all } = await published();
  return Response.json(
    all.map((entry) => ({
      title: entryTitle(entry),
      url: entryUrl(entry),
      text: plain(entry.body),
      description: excerpt(entry),
      tags: entry.data.tags,
      kind: entry.collection === 'posts' ? '文章' : '碎碎念',
      date: formatDate(entry.data.date),
    })),
  );
}
