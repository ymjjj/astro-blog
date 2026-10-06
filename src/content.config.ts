import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { publishedLoader } from './lib/published-loader';

const common = {
  date: z.coerce.date(),
  tags: z
    .array(z.string().trim().min(1))
    .default([])
    .transform((tags) => [...new Set(tags)]),
  draft: z.boolean().default(true),
};
const posts = defineCollection({
  loader: publishedLoader('src/content/posts'),
  schema: z
    .object({
      ...common,
      title: z.string().min(1),
      description: z.string().min(1),
      updated: z.coerce.date().optional(),
    })
    .refine((post) => !post.updated || post.updated >= post.date, {
      message: 'updated 不能早于 date',
      path: ['updated'],
    }),
});
const moments = defineCollection({
  loader: publishedLoader('src/content/moments'),
  schema: z.object({ ...common, title: z.string().min(1).optional() }),
});
export const collections = { posts, moments };
