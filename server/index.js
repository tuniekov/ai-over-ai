import * as dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { commands } from './commands.js';
import { FileUtils } from './fileUtils.js';
import { SYSTEM_PROMPTS, combinePrompts } from './prompts.js';
import { HierarchicalMemory } from './lib/hierarchicalMemory.js';
import { AI_MODELS, AI_SETTINGS, DEFAULT_MODEL } from '../src/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_DIR = join(__dirname, './memory');

// Настраиваем путь к .env файлу
dotenv.config({ path: join(__dirname, '../.env') });

// Инициализируем OpenAI
// const openai = new OpenAI({
//   apiKey: process.env.AITUNNEL_API_KEY
// });

// Создаем экземпляры утилит
const fileUtils = new FileUtils(WORKSPACE_DIR);
const memory = new HierarchicalMemory();
await memory.initialize();

// Определяем доступные функции
const availableFunctions = [
  {
    type: "function",
    function: {
      name: 'list',
      description: 'Получить список файлов и папок в указанной директории',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Путь к директории. Если не указан, используется корневая директория.'
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'read',
      description: 'Прочитать содержимое указанного файла',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Полный путь к файлу, который нужно прочитать'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'write',
      description: 'Записать текст в указанный файл',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Полный путь к файлу, в который нужно записать'
          },
          content: {
            type: 'string',
            description: 'Текст для записи в файл'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: "function",
    function: {
      name: 'save_history',
      description: 'Сохранить историю текущего чата в файл',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: 'Имя файла для сохранения истории'
          }
        },
        required: ['filename']
      }
    }
  },
  // {
  //   type: "function",
  //   function: {
  //     name: 'read_memory',
  //     description: 'Прочитать содержимое одного или нескольких файлов памяти',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         filename: {
  //           oneOf: [
  //             {
  //               type: 'string',
  //               description: 'Имя одного файла памяти (например, memory_0_1234567890.json)'
  //             },
  //             {
  //               type: 'array',
  //               items: {
  //                 type: 'string'
  //               },
  //               description: 'Массив имен файлов памяти для чтения нескольких файлов'
  //             }
  //           ]
  //         }
  //       },
  //       required: ['filename']
  //     }
  //   }
  // }
];

const wss = new WebSocketServer({ port: 3000 });

// Выносим логику чтения в отдельную асинхронную функцию
async function readStream(reader, ws, messages, modelConfig, baseURL, currentAbortController, chatHistory, currentModel, availableFunctions) {
  let responseText = '';
  let currentToolCall = null;
  let toolCallArguments = '';

  while (true) {
    try {
      const { done, value } = await reader.read();
      
      if (done) {
        console.log('Stream completed');
        ws.send(JSON.stringify({
          type: 'complete'
        }));
        return responseText;
      }

      // Декодируем и обрабатываем чанк
      const chunk = new TextDecoder().decode(value);
      const lines = chunk.split('\n');
      
      console.log('Received chunk:', chunk);

      for (const line of lines) {
        if (line.trim() === '') continue;
        
        if (line.startsWith('data: ')) {
          const jsonData = line.slice(6);
          console.log('Processing data line:', jsonData);

          if (jsonData === '[DONE]') {
            console.log('Received [DONE] marker');
            continue;
          }

          try {
            const parsed = JSON.parse(jsonData);
            console.log('Parsed JSON:', parsed);

            // Обычный контент
            if (parsed.choices[0]?.delta?.content) {
              const content = parsed.choices[0].delta.content;
              responseText += content;
              console.log('Content delta:', content);
              ws.send(JSON.stringify({
                type: 'partial',
                message: content
              }));
            }

            // Далее обработка tool_calls...

            // Обработка tool_calls
            if (parsed.choices[0]?.delta?.tool_calls) {
              const toolCallDelta = parsed.choices[0].delta.tool_calls[0];
              
              if (!currentToolCall && toolCallDelta.index === 0) {
                currentToolCall = {
                  name: toolCallDelta.function?.name || '',
                  arguments: ''
                };
              }
              
              if (currentToolCall) {
                if (toolCallDelta.function?.name) {
                  currentToolCall.name = toolCallDelta.function.name;
                }
                if (toolCallDelta.function?.arguments) {
                  toolCallArguments += toolCallDelta.function.arguments;
                  currentToolCall.arguments = toolCallArguments;
                }
              }
            }

            // При finish_reason === 'tool_calls'
            if (parsed.choices[0]?.finish_reason === 'tool_calls' && currentToolCall) {
              try {
                const args = JSON.parse(toolCallArguments);
                console.log('Tool call args:', args);

                // Проверяем и приводим path к строке если нужно
                if (args.path && typeof args.path !== 'string') {
                  args.path = String(args.path);
                }

                const result = await commands[currentToolCall.name](args, chatHistory, fileUtils);
                toolCallArguments = '';  // Очищаем аргументы

                // Формируем сообщение с результатом
                const messages1 = [
                  messages[0],
                  ...messages.slice(1, -1),
                  messages[messages.length - 1],
                  {
                    role: "user",
                    content: `Результат выполнения функции ${currentToolCall.name}:\n${result}`
                  }
                ];

                // Создаем новый запрос к модели
                const nextResponse = await fetch(`${baseURL}/chat/completions`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(modelConfig?.isAITunnel ? {
                      'Authorization': `Bearer ${process.env.AITUNNEL_API_KEY}`
                    } : {})
                  },
                  body: JSON.stringify({
                    model: currentModel,
                    messages: messages1,
                    stream: true,
                    tools: availableFunctions,
                    tool_choice: "auto",
                    temperature: modelConfig?.temperature || 0.7,
                    max_tokens: modelConfig?.maxTokens || 4096
                  }),
                  signal: currentAbortController.signal
                });

                // Продолжаем с новым reader
                reader = nextResponse.body.getReader();
                currentToolCall = null;
                continue;

              } catch (error) {
                console.error('Error in stream1:', error);
                // ... обработка ошибок ...
              }
            }
          } catch (error) {
            console.error('Error in stream2:', error);
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('Error in stream3:', error);
      throw error;
    }
  }
}

wss.on('connection', async (ws) => {
  console.log('Новое подключение');
  let currentModel = null;
  let currentAbortController = null;
  const chatHistory = [];

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);
      // Добавляем обработку смены модели
      if (data.type === 'changeModel') {
        const oldModel = currentModel;
        currentModel = data.modelPath;
        
        // Получаем конфигурацию новой модели
        const modelConfig = AI_MODELS[currentModel] || AI_MODELS[DEFAULT_MODEL];
        
        // Формируем информативное сообщение
        chatHistory.push({
            role: "system",
            content: `Модель изменена: ${oldModel || 'не задана'} → ${currentModel} (${modelConfig.description || 'нет описания'})`
        });
        console.log(`Переключение на модель: ${currentModel}`);
        ws.send(JSON.stringify({
            type: 'modelChanged',
            model: currentModel,
            message: `Переключение на модель: ${currentModel}`
        }));
        return;
      }
      
      if (data.type === 'abort') {
        console.log('Aborting generation');
        if (currentAbortController) {
          currentAbortController.abort();
        }
        return;
      }

      if (data.type === 'message') {
        currentAbortController = new AbortController();
        
        try {
          const content = data.message;

          chatHistory.push({ role: "user", content });

          const messages = [
            { 
              role: "system", 
              content: combinePrompts('default', 'conceptual') 
            },
            ...chatHistory,
            { 
              role: "user", 
              content 
            }
          ];

          // Определяем конфигурацию модели и baseURL
          const modelConfig = AI_MODELS[currentModel] || AI_MODELS[DEFAULT_MODEL];
          const baseURL = modelConfig?.isAITunnel 
              ? AI_SETTINGS.aitunnel.baseURL 
              : AI_SETTINGS.localai.baseURL;

          console.log('Using baseURL:', baseURL, 'for model:', currentModel);
          console.log('Model config:', modelConfig);

          const response = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(modelConfig?.isAITunnel ? {
                'Authorization': `Bearer ${process.env.AITUNNEL_API_KEY}`
              } : {})
            },
            body: JSON.stringify({
              model: currentModel,
              messages,
              stream: true,
              tools: availableFunctions,
              tool_choice: "auto",
              temperature: modelConfig?.temperature || 0.7,
              max_tokens: modelConfig?.maxTokens || 4096
            }),
            signal: currentAbortController.signal
          });

          const reader = response.body.getReader();
          
          // Обрабатываем стрим только один раз
          const responseText = await readStream(
            reader, 
            ws, 
            messages, 
            modelConfig, 
            baseURL, 
            currentAbortController,
            chatHistory,
            currentModel,
            availableFunctions
          );

          // Сохраняем ответ в историю
          chatHistory.push({
            role: "assistant",
            content: responseText
          });

          // Сохраняем в память
          await memory.saveMemory({
            messages: chatHistory.slice(-2),
            response: responseText
          });

        } catch (error) {
          if (error.name === 'AbortError') {
            ws.send(JSON.stringify({
              type: 'stopped',
              message: 'Генерация остановлена'
            }));
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('Ошибка:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: error.message || 'Произошла ошибка при обработке запроса'
      }));
    }
  });
}); 