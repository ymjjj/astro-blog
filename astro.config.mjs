import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { unified } from '@astrojs/markdown-remark';
import { site } from './src/site.config.js';
import { remarkLocalPaths } from './src/lib/remark-local-paths.mjs';
import { fileURLToPath } from 'node:url';

const base = process.env.BLOG_BASE || '/';
export default defineConfig({
  site: process.env.BLOG_SITE || site.url,
  base,
  output: 'static',
  // Snapshot builds share read-only dependencies, never their mutable content/cache stores.
  cacheDir: './.cache/astro',
  trailingSlash: 'always',
  vite: {
    cacheDir: './.cache/vite',
    server: {
      watch: {
        ignored: [
          '**/.blog/**',
          fileURLToPath(new URL('./.cache/**', import.meta.url)).replaceAll('\\', '/'),
        ],
      },
    },
  },
  integrations: [
    {
      name: 'local-draft-preview',
      hooks: {
        'astro:config:setup': ({ command, updateConfig }) => {
          // 按实际命令判断，不允许 NODE_ENV 或 --mode 把 build 变成草稿预览。
          updateConfig({
            vite: { define: { __LOCAL_DRAFTS__: JSON.stringify(command === 'dev') } },
          });
        },
      },
    },
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, [remarkLocalPaths, { base }]],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
