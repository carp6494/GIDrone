/**
 * babel-plugin-nxcode-source
 *
 * Babel 插件：为每个 JSX 元素注入 data-nxcode-source 属性
 * 用于 Element Inspector 功能的精准源码定位
 *
 * 输入:
 *   <button className="submit">登录</button>
 *
 * 输出:
 *   <button className="submit" data-nxcode-source="src/components/Login.tsx:42:5">登录</button>
 */

const path = require('path');

module.exports = function({ types: t }) {
  return {
    name: 'nxcode-source-plugin',

    visitor: {
      JSXOpeningElement(nodePath, state) {
        // 跳过 Fragment
        if (t.isJSXIdentifier(nodePath.node.name, { name: 'Fragment' })) {
          return;
        }

        // 跳过 React.Fragment
        if (t.isJSXMemberExpression(nodePath.node.name)) {
          const { object, property } = nodePath.node.name;
          if (
            t.isJSXIdentifier(object, { name: 'React' }) &&
            t.isJSXIdentifier(property, { name: 'Fragment' })
          ) {
            return;
          }
        }

        // 跳过已经有 data-nxcode-source 的元素
        const hasSource = nodePath.node.attributes.some(
          attr => t.isJSXAttribute(attr) &&
                  t.isJSXIdentifier(attr.name, { name: 'data-nxcode-source' })
        );
        if (hasSource) {
          return;
        }

        // 获取位置信息
        const { loc } = nodePath.node;
        if (!loc) {
          return;
        }

        // 获取相对路径
        const filename = state.filename || 'unknown';
        const rootDir = state.opts.rootDir || state.cwd || process.cwd();

        let relativePath;
        try {
          relativePath = path.relative(rootDir, filename).replace(/\\/g, '/');
          // 确保路径不以 ../ 开头（文件在 rootDir 外面）
          if (relativePath.startsWith('../')) {
            relativePath = path.basename(filename);
          }
        } catch {
          relativePath = path.basename(filename);
        }

        // 构建 source 值: "src/components/Button.tsx:42:5"
        const sourceValue = `${relativePath}:${loc.start.line}:${loc.start.column + 1}`;

        // 注入 data-nxcode-source 属性
        nodePath.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-nxcode-source'),
            t.stringLiteral(sourceValue)
          )
        );
      },
    },
  };
};
