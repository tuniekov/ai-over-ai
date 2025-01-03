import { mkdir, access, writeFile, readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AI_MODELS, AI_SETTINGS, DEFAULT_MODEL } from '../../src/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

export class HierarchicalMemory {
    constructor(baseDir = join(PROJECT_ROOT, 'server/memory'), operativeLimit = 10) {
        this.baseDir = baseDir;
        this.operativeMemoryFile = join(this.baseDir, 'operative.json');
        this.summaryModel = AI_MODELS[DEFAULT_MODEL];
        this.operativeLimit = operativeLimit;
    }

    // Вспомогательный метод для получения полного пути к файлу
    getFilePath(filename) {
        return join(this.baseDir, filename);
    }

    async initialize() {
        try {
            await mkdir(this.baseDir, { recursive: true });
            
            try {
                await access(this.operativeMemoryFile);
                // Загружаем существующие файлы высших уровней
                await this.loadHigherLevelMemories();
            } catch {
                await writeFile(this.operativeMemoryFile, JSON.stringify({
                    summaries: [],
                    references: {}
                }));
            }
        } catch (error) {
            console.error('Ошибка при инициализации памяти:', error);
            throw error;
        }
    }

    async loadHigherLevelMemories() {
        try {
            const files = await readdir(this.baseDir);
            const operativeMemory = JSON.parse(
                await readFile(this.operativeMemoryFile, 'utf-8')
            );

            // Находим файлы более высоких уровней
            const higherLevelFiles = files.filter(file => {
                const match = file.match(/^memory_(\d+)_/);
                return match && parseInt(match[1]) > 0;
            });

            // Загружаем содержимое каждого файла
            for (const file of higherLevelFiles) {
                try {
                    const content = JSON.parse(
                        await readFile(join(this.baseDir, file), 'utf-8')
                    );

                    // Проверяем, есть ли уже такая запись
                    const existingIndex = operativeMemory.summaries.findIndex(
                        s => s.reference === file
                    );

                    const summary = {
                        id: file.split('_')[2].replace('.json', ''),
                        summary: content.periodSummary,
                        type: 'period_summary',
                        reference: file,
                        timestamp: content.timestamp,
                        level: parseInt(file.split('_')[1])
                    };

                    if (existingIndex === -1) {
                        // Добавляем новую запись
                        operativeMemory.summaries.unshift(summary);
                    } else {
                        // Обновляем существующую
                        operativeMemory.summaries[existingIndex] = summary;
                    }
                } catch (error) {
                    console.error(`Ошибка загрузки файла ${file}:`, error);
                }
            }

            // Сохраняем обновленную оперативную память
            await writeFile(
                this.operativeMemoryFile,
                JSON.stringify(operativeMemory, null, 2)
            );

        } catch (error) {
            console.error('Ошибка при загрузке файлов высших уровней:', error);
        }
    }

    async saveMemory(content, level = 0) {
        try {
            const memoryId = Date.now().toString();
            const filename = `memory_${level}_${memoryId}.json`;
            const filePath = this.getFilePath(filename);

            // Сохраняем новое сообщение
            await writeFile(filePath, JSON.stringify({
                content,
                timestamp: new Date().toISOString(),
                level
            }));

            // Обновляем оперативную память
            const operativeMemory = JSON.parse(
                await readFile(this.operativeMemoryFile, 'utf-8')
            );

            // Группируем сообщения по уровням
            const messagesByLevel = {};
            for (const summary of operativeMemory.summaries) {
                const lvl = summary.level || 0;
                messagesByLevel[lvl] = messagesByLevel[lvl] || [];
                messagesByLevel[lvl].push(summary);
            }

            // Проверяем и архивируем каждый уровень последовательно
            for (let currentLevel = 0; currentLevel < 10; currentLevel++) { // Ограничиваем 10 уровнями
                const messagesAtLevel = messagesByLevel[currentLevel] || [];
                
                if (messagesAtLevel.length >= this.operativeLimit) {
                    console.log(`Архивируем уровень ${currentLevel}`);
                    
                    // Получаем сообщения для архивации
                    const toArchive = messagesAtLevel.slice(0, this.operativeLimit);
                    
                    // Формируем контент для резюме
                    const archiveContent = await this.getFullContentForSummaries(toArchive);
                    
                    // Создаем резюме через AI
                    const periodSummary = await this.generatePeriodSummary(archiveContent);
                    
                    // Сохраняем архив в следующий уровень
                    const archiveId = await this.saveToNextLevel(toArchive, periodSummary, currentLevel + 1);
                    
                    // Обновляем оперативную память
                    const newSummary = {
                        id: archiveId,
                        summary: periodSummary,
                        type: 'period_summary',
                        startTime: toArchive[0].timestamp,
                        endTime: toArchive[toArchive.length - 1].timestamp,
                        reference: `memory_${currentLevel + 1}_${archiveId}.json`,
                        level: currentLevel + 1
                    };

                    // Удаляем архивированные сообщения и добавляем резюме
                    operativeMemory.summaries = operativeMemory.summaries.filter(
                        s => !toArchive.some(a => a.id === s.id)
                    );
                    operativeMemory.summaries.unshift(newSummary);

                    // Обновляем группировку для следующего уровня
                    messagesByLevel[currentLevel + 1] = messagesByLevel[currentLevel + 1] || [];
                    messagesByLevel[currentLevel + 1].push(newSummary);
                }
            }

            // Сохраняем новое сообщение
            const memoryFile = join(this.baseDir, `memory_${level}_${memoryId}.json`);
            await writeFile(memoryFile, JSON.stringify({
                content,
                timestamp: new Date().toISOString(),
                level
            }));

            // Создаем краткое описание
            const summary = await this.generateSummary(content);
            
            // Добавляем новое сообщение
            operativeMemory.summaries.push({
                id: memoryId,
                summary,
                type: 'message',
                reference: `memory_${level}_${memoryId}.json`,
                timestamp: new Date().toISOString(),
                level
            });

            await writeFile(
                this.operativeMemoryFile, 
                JSON.stringify(operativeMemory, null, 2)
            );

            return memoryId;
        } catch (error) {
            console.error('Ошибка при сохранении в память:', error);
            throw error;
        }
    }

    async getFullContentForSummaries(summaries) {
        const contents = [];
        for (const summary of summaries) {
            try {
                const filePath = this.getFilePath(summary.reference);
                const content = await readFile(filePath, 'utf-8');
                contents.push(JSON.parse(content));
            } catch (error) {
                console.error(`Ошибка чтения файла ${summary.reference}:`, error);
            }
        }
        return contents;
    }

    async generatePeriodSummary(contents) {
        try {
            const response = await fetch(`${AI_SETTINGS.aitunnel.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.AITUNNEL_API_KEY}`
                },
                body: JSON.stringify({
                    model: this.summaryModel.modelPath,
                    messages: [
                        {
                            role: 'system',
                            content: `Ты работаешь с иерархической системой памяти. Память организована по уровням:

Уровень 0: Исходные сообщения и диалоги
Уровень 1: Резюме групп сообщений уровня 0
Уровень 2: Резюме групп резюме уровня 1
И так далее...

Каждый уровень содержит более обобщенную информацию, чем предыдущий.

Твоя задача:
1. Создать подробное резюме для перехода на следующий уровень
2. Включить ключевые темы, решения и выводы
3. Сохранить важные детали, которые могут понадобиться позже
4. Структурировать информацию для удобного поиска

При чтении памяти:
- Начинай с высших уровней для общего контекста
- Спускайся на нижние уровни только для получения конкретных деталей
- Используй ссылки между уровнями для навигации
- Не пытайся читать все файлы сразу

Формат резюме:
1. Период: [начальная дата] - [конечная дата]
2. Основные темы: [список]
3. Ключевые события: [список]
4. Важные решения: [список]
5. Общие выводы: [текст]`
                        },
                        {
                            role: 'user',
                            content: JSON.stringify(contents)
                        }
                    ],
                    max_tokens: this.summaryModel.maxTokens,
                    temperature: 0.3,
                    stream: false
                })
            });

            const result = await response.json();
            return result.choices[0].message.content;
        } catch (error) {
            console.error('Ошибка при генерации резюме периода:', error);
            return 'Ошибка генерации резюме периода';
        }
    }

    async saveToNextLevel(summaries, periodSummary, nextLevel) {
        const archiveId = Date.now().toString();
        const filename = `memory_${nextLevel}_${archiveId}.json`;
        const filePath = this.getFilePath(filename);
        
        await writeFile(filePath, JSON.stringify({
            summaries,
            periodSummary,
            timestamp: new Date().toISOString(),
            level: nextLevel
        }));

        return archiveId;
    }

    async generateSummary(content) {
        // return 'Ошибка генерации краткого описания';
        try {
            const baseURL = AI_SETTINGS.aitunnel.baseURL;
            
            const response = await fetch(`${baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.AITUNNEL_API_KEY}`
                },
                body: JSON.stringify({
                    model: this.summaryModel.modelPath,
                    messages: [
                        {
                            role: 'system',
                            content: 'Создай краткое описание (не более 100 символов) следующего текста или диалога. Описание должно отражать ключевую суть взаимодействия.'
                        },
                        {
                            role: 'user',
                            content: typeof content === 'string' ? content : JSON.stringify(content)
                        }
                    ],
                    max_tokens: this.summaryModel.maxTokens,
                    temperature: 0.3,
                    stream: false
                })
            });

            const result = await response.json();
            
            if (!result.choices || !result.choices[0]?.message?.content) {
                throw new Error('Некорректный ответ от API');
            }

            return result.choices[0].message.content;
        } catch (error) {
            console.error('Ошибка при генерации саммари:', error);
            return 'Ошибка генерации краткого описания';
        }
    }

    async getRecentMemories(limit = 5) {
        try {
            const operativeMemory = JSON.parse(
                await readFile(this.operativeMemoryFile, 'utf-8')
            );
            
            return operativeMemory.summaries.slice(-limit);
        } catch (error) {
            console.error('Ошибка при получении последних воспоминаний:', error);
            return [];
        }
    }
} 