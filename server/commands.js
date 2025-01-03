import { join } from 'path';
import fs from 'fs/promises';

const HISTORY_DIR = 'history';

function cleanPath(path) {
  // Удаляем текст в квадратных скобках и сами скобки
  let cleaned = path.replace(/\[.*?\]/g, '').trim();
  
  // Заменяем обратные слеши на прямые
  cleaned = cleaned.replace(/\\/g, '/');
  
  // Удаляем все префиксы путей
  cleaned = cleaned
    .replace(/^V:\/node\/ai0\/workspace\//, '')
    .replace(/^V:\\node\\ai0\\workspace\\/, '')
    .replace(/^workspace\//, '')
    .replace(/^workspace\\/, '');
  
  // Удаляем повторяющиеся слеши
  cleaned = cleaned.replace(/\/+/g, '/');
  
  // Удаляем начальный и конечный слеш
  cleaned = cleaned.replace(/^\/+|\/+$/g, '');
  
  // Удаляем пробелы и переносы строк
  cleaned = cleaned.replace(/\s+/g, '');
  
  return cleaned;
}

export const commands = {
  async save_history(args, chatHistory, fileUtils) {
    const historyPath = join(fileUtils.workspaceDir, HISTORY_DIR);
    await fs.mkdir(historyPath, { recursive: true });

    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = args ? `${date}_${cleanPath(args)}` : `${date}_chat.txt`;
    
    const fullPath = join(HISTORY_DIR, filename);
    await fileUtils.saveHistoryToFile(fullPath, chatHistory);
    return `История чата сохранена в файл ${fullPath}`;
  },

  async read(args, _, fileUtils) {
    if (!args) {
      return 'Ошибка: не указан путь к файлу';
    }
    const path = cleanPath(args.path);
    const content = await fileUtils.readFile(path);
    return `Содержимое файла ${path}:\n${content}`;
  },

  async write(args, _, fileUtils) {
    if (!args || !args.path || !args.content) {
      return 'Ошибка: требуется указать путь к файлу и содержимое';
    }
    
    const path = cleanPath(args.path);
    await fileUtils.writeFile(path, args.content);
    return `Файл ${path} успешно записан`;
  },

  async list(args, _, fileUtils) {
    try {
      const path = args ? cleanPath(args) : '';
      const files = await fileUtils.listFiles(path);
      return files || 'Директория пуста';
    } catch (error) {
      return `Ошибка при чтении директории: ${error.message}`;
    }
  },

  async read_memory(args, _, fileUtils) {
    try {
        let filenames;
        
        // Проверяем, передан ли один файл или массив
        if (typeof args === 'string') {
            filenames = [args];
        } else if (Array.isArray(args)) {
            filenames = args;
        } else if (args.filename) {
            // Если filename это массив или строка
            filenames = Array.isArray(args.filename) ? args.filename : [args.filename];
        } else {
            throw new Error('Не указаны файлы для чтения');
        }

        // Читаем все файлы
        const results = await Promise.all(filenames.map(async (filename) => {
            // Проверяем формат имени файла
            if (typeof filename !== 'string' || !filename.match(/^memory_\d+_\d+\.json$/)) {
                return `Пропущен ${filename}: неверный формат имени файла`;
            }

            try {
                const content = await fileUtils.readFile(filename);
                const data = JSON.parse(content);

                // Форматируем вывод в зависимости от типа файла
                if (data.content) {
                    return `=== Файл: ${filename} ===\nВремя: ${data.timestamp}\nУровень: ${data.level}\n\nСодержимое:\n${JSON.stringify(data.content, null, 2)}`;
                } else if (data.periodSummary) {
                    return `=== Файл: ${filename} ===\nВремя: ${data.timestamp}\nУровень: ${data.level}\n\nРезюме периода:\n${data.periodSummary}\n\nВключает сообщения:\n${data.summaries.map(s => s.reference).join('\n')}`;
                } else {
                    return `=== Файл: ${filename} ===\nСодержимое:\n${JSON.stringify(data, null, 2)}`;
                }
            } catch (error) {
                return `Ошибка чтения ${filename}: ${error.message}`;
            }
        }));

        return results.join('\n\n');
    } catch (error) {
        throw new Error(`Ошибка чтения файлов памяти: ${error.message}`);
    }
  }
}; 