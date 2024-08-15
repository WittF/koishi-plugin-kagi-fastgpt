import { Context, Schema, Session, Logger } from 'koishi';
import axios from 'axios';

export const name = 'kagi-fastgpt';

export interface Config {
  apiKey: string;
  debugMode: boolean;
}

export const schema: Schema<Config> = Schema.object({
  apiKey: Schema.string().description('API 密钥'),
  debugMode: Schema.boolean().description('启用调试模式').default(false),
});

export function apply(ctx: Context, config: Config) {
  const logger = new Logger('kagi-fastgpt');
  const apiUrl = 'https://kagi.com/api/v0/fastgpt';

  if (config.debugMode) {
    logger.info('🚀 插件已加载，调试模式已启用');
  }

  ctx.command('kagi.ask <question:text>', '🤖 向 FastGPT 提问')
    .action(async ({ session }, question) => {
      logger.info(`📥 收到提问: ${question}`);
      
      try {
        const response = await axios.post(apiUrl, {
          query: question,
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
          let referenceText = '';

          if (references.length > 0) {
            referenceText = '\n\n📚 参考资料:\n';
            references.forEach((ref, index) => {
              referenceText += `${index + 1}. ${ref.title} - ${ref.url}\n`;
            });
          }

          const finalResponse = `@${session.username} \n\n🧐 您提问的问题: ${question}\n\n💬 回答:\n${answer}${referenceText}`;
          logger.info(`📤 回复: ${finalResponse}`);
          return finalResponse;
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
}
