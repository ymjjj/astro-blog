// Markdown 中的 /media/ 和站内链接也必须服从 GitHub Pages 的子路径。
export function remarkLocalPaths({ base = '/' } = {}) {
  const prefix = '/' + base.split('/').filter(Boolean).join('/');
  return (tree) => {
    function walk(node) {
      if (typeof node.url === 'string' && node.url.startsWith('/') && !node.url.startsWith('//')) {
        node.url = prefix === '/' ? node.url : prefix + node.url;
      }
      if (node.children) node.children.forEach(walk);
    }
    walk(tree);
  };
}
