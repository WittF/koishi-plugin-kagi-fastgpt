# koishi-plugin-kagi-fastgpt

[![npm](https://img.shields.io/npm/v/koishi-plugin-kagi-fastgpt?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-kagi-fastgpt)

基于 Kagi API 的 FastGPT 搜索插件

## 更新日志

### v1.1.0
- 优化图片渲染效果
- 支持 Markdown 格式渲染
- 改进参考资料显示格式
- 修复图片高度计算问题

### v1.0.1
- 初始版本发布

## 使用方法

1. 安装插件：
```bash
npm install koishi-plugin-kagi-fastgpt
```

2. 在 Koishi 配置文件中启用插件：
```typescript
export default {
  plugins: {
    'kagi-fastgpt': {
      apiKey: '你的 Kagi API 密钥',
    },
  },
}
```

3. 使用命令：
- `kagi.ask <问题>` - 向 FastGPT 提问
- `kagi.ask <问题> -i` - 以图片形式显示回答
- `kagi.help` - 查看帮助信息

## 配置项

- `apiKey`: Kagi API 密钥
- `debugMode`: 是否启用调试模式（默认：false）
- `imageBackground`: 图片背景颜色（默认：#ffffff）
- `imageWidth`: 图片宽度（默认：500，范围：300-1000）

## 依赖项

- koishi >= 4.3.2
- canvas（可选，用于图片渲染）

🧩自用