import { Context, Schema, Session, Logger, h } from 'koishi';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs/promises';

export const name = 'kagi-fastgpt';

export interface Config {
  apiKey: string;
  debugMode: boolean;
  imageBackground: string;
  imageWidth: number;
}

export const schema: Schema<Config> = Schema.object({
  apiKey: Schema.string().description('API 密钥'),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
  imageBackground: Schema.string()
    .description('图片背景颜色（十六进制色值，如#ffffff)')
    .default('#ffffff'),
  imageWidth: Schema.number()
    .description('渲染图片的宽度(像素)，默认为500')
    .min(300)
    .max(1000)
    .default(500),
});

// 声明插件可选依赖
export const inject = {
  optional: ['canvas'],
};

// 声明Skia Canvas插件接口
declare module 'koishi' {
  interface Context {
    canvas?: {
      createCanvas(width: number, height: number): any
      loadFont(name: string, path: string): void
      registerFont(path: string, options?: { family?: string }): void
      loadImage(buffer: Buffer | string): Promise<any>
    }
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('kagi-fastgpt');
  const apiUrl = 'https://kagi.com/api/v0/fastgpt';

  if (config.debugMode) {
    logger.info('🚀 插件已加载，调试模式已启用');
  }

  // 检查canvas插件是否可用
  let hasCanvas = !!ctx.canvas;
  if (hasCanvas) {
    logger.info('检测到canvas插件，可使用图片渲染模式');
  } else {
    logger.info('未检测到canvas插件，无法使用图片渲染模式');
    
    // 设置定时器，每30秒检查一次canvas插件是否可用
    const checkInterval = setInterval(() => {
      const canvasAvailable = !!ctx.canvas;
      if (canvasAvailable && !hasCanvas) {
        hasCanvas = true;
        logger.info('检测到canvas插件已加载，现在可以使用图片渲染模式');
        clearInterval(checkInterval);
      }
    }, 30000); // 每30秒检查一次
    
    // 在插件卸载时清除定时器
    ctx.on('dispose', () => {
      clearInterval(checkInterval);
    });
  }

  // 创建数据目录
  const dataDir = path.join(ctx.baseDir, 'data', 'kagi-fastgpt');
  fs.mkdir(dataDir, { recursive: true }).catch(err => {
    logger.error(`创建数据目录失败: ${err.message}`, err);
  });

  // 文本换行辅助函数
  const wrapText = (context: any, text: string, maxWidth: number): string[] => {
    // 处理 Markdown 格式
    const processedText = text
      .replace(/\*\*(.*?)\*\*/g, '$1') // 移除加粗
      .replace(/\*(.*?)\*/g, '$1')     // 移除斜体
      .replace(/`(.*?)`/g, '$1')       // 移除代码块
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1') // 移除链接
      .replace(/\n/g, ' ');            // 将换行转换为空格
    
    const words = processedText.split('');
    const lines: string[] = [];
    let currentLine = '';
    
    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine + words[i];
      const metrics = context.measureText(testLine);
      const testWidth = metrics.width;
      
      if (testWidth > maxWidth && i > 0) {
        lines.push(currentLine);
        currentLine = words[i];
      } else {
        currentLine = testLine;
      }
    }
    
    lines.push(currentLine);
    return lines;
  };

  // 渲染 Markdown 文本
  const renderMarkdownText = (ctx2d: any, text: string, x: number, y: number, maxWidth: number, lineHeight: number, fontSize: number) => {
    let currentY = y;
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g);
    
    parts.forEach(part => {
      if (!part) return;
      
      let fontStyle = 'normal';
      let fontWeight = 'normal';
      
      if (part.startsWith('**') && part.endsWith('**')) {
        // 加粗文本
        fontWeight = 'bold';
        part = part.slice(2, -2);
      } else if (part.startsWith('*') && part.endsWith('*')) {
        // 斜体文本
        fontStyle = 'italic';
        part = part.slice(1, -1);
      } else if (part.startsWith('`') && part.endsWith('`')) {
        // 代码块
        ctx2d.fillStyle = '#f0f0f0';
        part = part.slice(1, -1);
      } else if (part.startsWith('[') && part.includes('](')) {
        // 链接
        const [text, url] = part.match(/\[(.*?)\]\((.*?)\)/).slice(1);
        part = text;
        ctx2d.fillStyle = '#3498db';
      }
      
      ctx2d.font = `${fontWeight} ${fontStyle} ${fontSize}px LXGW WenKai Lite`;
      const lines = wrapText(ctx2d, part, maxWidth);
      
      lines.forEach(line => {
        ctx2d.fillText(line, x, currentY);
        currentY += lineHeight;
      });
      
      // 重置样式
      ctx2d.fillStyle = '#2c3e50';
      ctx2d.font = `${fontSize}px LXGW WenKai Lite`;
    });
    
    return currentY;
  };

  // 使用canvas渲染回答图片
  const renderAnswerImage = async (
    question: string,
    answer: string,
    references: any[] = []
  ): Promise<string> => {
    if (!ctx.canvas) {
      throw new Error('canvas插件不可用');
    }

    try {
      const canvas = ctx.canvas;
      const width = config.imageWidth;
      const padding = 30;
      const lineHeight = 24;
      const titleFontSize = 18;
      const contentFontSize = 16;
      
      // 计算文本换行和高度
      const context = canvas.createCanvas(width, 100).getContext('2d');
      context.font = `${contentFontSize}px LXGW WenKai Lite`;
      
      // 计算问题文本高度
      const questionLines = wrapText(context, question, width - (padding * 2));
      const questionHeight = questionLines.length * lineHeight;
      
      // 计算回答文本高度（使用临时画布测量）
      const tempCanvas = canvas.createCanvas(width, 1000);
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.font = `${contentFontSize}px LXGW WenKai Lite`;
      let answerHeight = 0;
      const parts = answer.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g);
      parts.forEach(part => {
        if (!part) return;
        const lines = wrapText(tempCtx, part, width - (padding * 2));
        answerHeight += lines.length * lineHeight;
      });
      
      // 计算参考资料高度
      let referencesHeight = 0;
      if (references.length > 0) {
        referencesHeight = lineHeight * 2; // 标题高度
        references.forEach(ref => {
          // 计算标题高度
          const titleText = `${ref.title}`;
          const titleLines = wrapText(context, titleText, width - (padding * 2));
          referencesHeight += titleLines.length * lineHeight;
          
          // 计算地址高度
          const urlLines = wrapText(context, ref.url, width - (padding * 2));
          referencesHeight += urlLines.length * lineHeight;
          
          // 添加间距
          referencesHeight += lineHeight / 2;
        });
      }
      
      // 计算总高度（添加额外的padding以确保内容完整显示）
      const totalHeight = padding * 2 + questionHeight + lineHeight * 2 + answerHeight + referencesHeight + padding;
      
      // 创建最终画布
      const canv = canvas.createCanvas(width, totalHeight);
      const ctx2d = canv.getContext('2d');
      
      // 设置背景
      ctx2d.fillStyle = config.imageBackground;
      ctx2d.fillRect(0, 0, width, totalHeight);
      
      // 绘制问题
      ctx2d.fillStyle = '#2c3e50';
      ctx2d.font = `bold ${titleFontSize}px LXGW WenKai Lite`;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText('问题', padding, padding);
      
      // 绘制问题下划线
      ctx2d.strokeStyle = '#3498db';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(padding, padding + titleFontSize + 5);
      ctx2d.lineTo(padding + 50, padding + titleFontSize + 5);
      ctx2d.stroke();
      
      ctx2d.font = `${contentFontSize}px LXGW WenKai Lite`;
      let y = padding + titleFontSize + 15;
      questionLines.forEach(line => {
        ctx2d.fillText(line, padding, y);
        y += lineHeight;
      });
      
      // 绘制回答
      y += lineHeight;
      ctx2d.font = `bold ${titleFontSize}px LXGW WenKai Lite`;
      ctx2d.fillText('回答', padding, y);
      
      // 绘制回答下划线
      ctx2d.beginPath();
      ctx2d.moveTo(padding, y + titleFontSize + 5);
      ctx2d.lineTo(padding + 50, y + titleFontSize + 5);
      ctx2d.stroke();
      
      y += titleFontSize + 15;
      y = renderMarkdownText(ctx2d, answer, padding, y, width - (padding * 2), lineHeight, contentFontSize);
      
      // 绘制参考资料
      if (references.length > 0) {
        y += lineHeight;
        ctx2d.font = `bold ${titleFontSize}px LXGW WenKai Lite`;
        ctx2d.fillText('参考资料', padding, y);
        
        // 绘制参考资料下划线
        ctx2d.beginPath();
        ctx2d.moveTo(padding, y + titleFontSize + 5);
        ctx2d.lineTo(padding + 80, y + titleFontSize + 5);
        ctx2d.stroke();
        
        y += titleFontSize + 15;
        ctx2d.font = `${contentFontSize}px LXGW WenKai Lite`;
        references.forEach((ref, index) => {
          // 绘制标题
          const titleText = `${index + 1}. ${ref.title}`;
          const titleLines = wrapText(ctx2d, titleText, width - (padding * 2));
          titleLines.forEach(line => {
            ctx2d.fillText(line, padding, y);
            y += lineHeight;
          });
          
          // 绘制地址（使用蓝色）
          ctx2d.fillStyle = '#3498db';
          const urlLines = wrapText(ctx2d, ref.url, width - (padding * 2));
          urlLines.forEach(line => {
            ctx2d.fillText(line, padding, y);
            y += lineHeight;
          });
          
          // 重置颜色并添加间距
          ctx2d.fillStyle = '#2c3e50';
          y += lineHeight / 2;
        });
      }
      
      // 保存图片到内存并返回base64数据
      const buffer = canv.toBuffer('image/png');
      const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;
      
      logger.debug(`图片渲染完成: 大小=${buffer.length}字节`);
      return base64Image;
    } catch (error) {
      logger.error(`图片渲染失败`, error);
      throw new Error(`图片渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };
  
  // 定义主命令
  ctx.command('kagi.ask <question:text>', '🤖 向 FastGPT 提问')
    .action(async ({ session }, question) => {
      logger.info(`📥 收到提问: ${question}`);
      
      // 检查canvas的可用性
      const useImage = /\s-i\s*$/.test(question);
      const cleanQuestion = question.replace(/\s-i\s*$/, '').trim();
      
      logger.info(`📥 清理后的问题: ${cleanQuestion}`);
      logger.info(`📥 是否启用图片模式: ${useImage}`);
      
      if (!hasCanvas && useImage) {
        logger.warn('用户请求图片模式，但canvas不可用');
        await session.send('图片渲染服务不可用，将以文本模式显示结果');
      }
      
      try {
        const response = await axios.post(apiUrl, {
          query: cleanQuestion,
          cache: true,
          web_search: true,
        }, {
          headers: {
            'Authorization': `Bot ${config.apiKey}`,
          },
        });

        if (config.debugMode && response.data && response.data.meta) {
          logger.info(`🔍 消息 ID: ${response.data.meta.id}`);
          logger.info(`💰 API 余额: ${response.data.meta.api_balance}`);
          logger.info(`📄 API 响应: ${JSON.stringify(response.data)}`);
        }

        if (response.data && response.data.data && response.data.data.output) {
          const answer = response.data.data.output;
          const references = response.data.data.references || [];
          
          // 根据参数决定使用图片渲染还是文本模式
          if (useImage) {
            try {
              // 发送等待消息
              const loadingMsg = await session.send('正在生成回答并渲染图片...请稍等~');
              
              // 渲染图片
              const imageData = await renderAnswerImage(cleanQuestion, answer, references);
              
              // 发送图片并撤回加载消息
              await session.send(h.image(imageData));
              
              // 尝试撤回等待消息
              try {
                if (loadingMsg) {
                  logger.debug(`尝试撤回临时消息，ID类型: ${typeof loadingMsg}, 数据: ${JSON.stringify(loadingMsg, null, 2)}`);
                  
                  // 根据不同平台适配消息ID提取
                  let messageId: string | undefined;
                  
                  if (typeof loadingMsg === 'string') {
                    messageId = loadingMsg;
                  } else if (typeof loadingMsg === 'object' && loadingMsg !== null) {
                    // 尝试各种可能的属性路径获取消息ID
                    if (Array.isArray(loadingMsg) && loadingMsg.length > 0) {
                      // 数组格式，尝试获取第一个元素
                      const firstElement = loadingMsg[0];
                      if (firstElement && typeof firstElement === 'object') {
                        messageId = (firstElement as any).messageId || (firstElement as any).id;
                      } else if (firstElement && typeof firstElement === 'string') {
                        messageId = firstElement;
                      }
                    } else {
                      // 尝试常见的消息ID属性
                      const msgObj = loadingMsg as Record<string, any>;
                      messageId = msgObj['messageId'] || 
                               msgObj['id'] || 
                               msgObj['message_id'] || 
                               (msgObj['data'] && msgObj['data']['messageId']) ||
                               (msgObj['data'] && msgObj['data']['id']) ||
                               (msgObj['data'] && msgObj['data']['message_id']);
                    }
                  }
                  
                  if (messageId) {
                    logger.debug(`找到消息ID: ${messageId}，准备撤回`);
                    await session.bot.deleteMessage(session.channelId, messageId);
                    logger.debug(`成功撤回临时消息`);
                  } else {
                    logger.warn(`无法获取临时消息ID，撤回失败，消息对象: ${typeof loadingMsg === 'object' ? JSON.stringify(loadingMsg) : loadingMsg}`);
                  }
                }
              } catch (deleteError) {
                logger.warn(`撤回等待消息失败: ${deleteError instanceof Error ? deleteError.message : '未知错误'}`, deleteError);
                // 失败不影响主流程
              }
            } catch (error) {
              logger.error(`图片渲染失败，退回使用文本模式`, error);
              // 如果图片渲染失败，使用文本模式
              let referenceText = '';
              if (references.length > 0) {
                referenceText = '\n\n📚 参考资料:\n';
                references.forEach((ref, index) => {
                  referenceText += `${index + 1}. ${ref.title} - ${ref.url}\n`;
                });
              }
              
              const finalResponse = `@${session.username} \n\n🧐 您提问的问题: ${cleanQuestion}\n\n💬 回答:\n${answer}${referenceText}`;
              logger.info(`📤 回复: ${finalResponse}`);
              return finalResponse;
            }
          } else {
            // 文本模式
            let referenceText = '';
            if (references.length > 0) {
              referenceText = '\n\n📚 参考资料:\n';
              references.forEach((ref, index) => {
                referenceText += `${index + 1}. ${ref.title} - ${ref.url}\n`;
              });
            }
            
            const finalResponse = `@${session.username} \n\n🧐 您提问的问题: ${cleanQuestion}\n\n💬 回答:\n${answer}${referenceText}`;
            logger.info(`📤 回复: ${finalResponse}`);
            return finalResponse;
          }
        } else {
          if (config.debugMode) {
            logger.warn(`⚠️ 未获取到有效的回答: ${JSON.stringify(response.data)}`);
          }
          return '❌ 无法获取有效回答';
        }
      } catch (error) {
        logger.error(`🚨 请求失败: ${error.message}`);
        if (config.debugMode && error.response) {
          logger.error(`🚨 详细错误信息: ${JSON.stringify(error.response.data)}`);
        }
        return '❌ 发生错误，无法获取回答';
      }
    });
    
  // 注册帮助信息
  ctx.command('kagi.help', '获取FastGPT指令帮助信息')
    .action(async ({ session }) => {
      const helpText = `
📋 FastGPT查询指令使用说明：

1️⃣ 基本用法：
   kagi.ask <问题>
   例如：kagi.ask 什么是人工智能？

2️⃣ 以图片形式显示（需安装canvas插件）：
   kagi.ask <问题> -i
   例如：kagi.ask 什么是人工智能？ -i

❓ 查看帮助：
   kagi.help
      `;
      await session.send(helpText);
    });
}

/*
 * 关于图片渲染：
 * 
 * 本插件现使用 canvas 进行图片渲染，这是一个基于 Skia 的 Canvas 实现。
 * 相比 Puppeteer，它更轻量，不需要浏览器环境，性能更好。
 * 
 * 使用须知：
 * 1. 需要在Koishi市场安装 canvas 插件
 * 2. 默认使用 "LXGW WenKai Lite" 字体，确保在canvas设置中配置了该字体
 * 3. 如果需要更改字体，修改renderAnswerImage函数中的字体设置
 */
