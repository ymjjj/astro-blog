import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import type { Loader } from 'astro/loaders';

// 生产模式在渲染/发现图片依赖之前排除草稿；本地 dev 允许单独预览。
export function publishedLoader(directory: string): Loader {
  return {
    name: `published-${directory}`,
    async load(context) {
      const root = fileURLToPath(context.config.root);
      const base = resolve(root, directory);
      const list = async (folder: string): Promise<string[]> =>
        (
          await Promise.all(
            (await readdir(folder, { withFileTypes: true })).map((entry) =>
              entry.isDirectory()
                ? list(join(folder, entry.name))
                : entry.name.endsWith('.md')
                  ? [join(folder, entry.name)]
                  : [],
            ),
          )
        ).flat();
      async function sync() {
        context.store.clear();
        for (const file of await list(base)) {
          const id = relative(base, file).replaceAll('\\', '/').replace(/\.md$/, '');
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(id))
            throw new Error(`内容文件名需使用小写英文、数字和连字符：${file}`);
          const source = await readFile(file, 'utf8');
          const { data, content } = matter(source);
          const parsed = await context.parseData({ id, data, filePath: file });
          if (parsed.draft !== false && !__LOCAL_DRAFTS__) continue;
          const rendered = await context.renderMarkdown(content, { fileURL: pathToFileURL(file) });
          context.store.set({
            id,
            data: parsed,
            body: content,
            filePath: relative(root, file).replaceAll('\\', '/'),
            rendered,
            assetImports: rendered.metadata?.imagePaths,
            digest: context.generateDigest(source),
          });
        }
      }
      await sync();
      // 开发模式也走相同发布规则；变更串行处理，避免快速保存造成竞态。
      if (context.watcher) {
        let queue = Promise.resolve();
        context.watcher.add(base);
        const onChange = (file: string) => {
          const rel = relative(base, resolve(file));
          if (rel.startsWith('..') || !file.endsWith('.md')) return;
          queue = queue.then(sync).catch((error) => context.logger.error(String(error)));
        };
        context.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
      }
    },
  };
}
