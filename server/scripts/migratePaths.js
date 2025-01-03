import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function migratePaths() {
    const baseDir = 'memory';
    const operativeFile = join(baseDir, 'operative.json');

    try {
        // Читаем все файлы в директории
        const files = await readdir(baseDir);
        
        // Обрабатываем operative.json
        const operativeContent = await readFile(operativeFile, 'utf-8');
        const operative = JSON.parse(operativeContent);

        // Исправляем пути в summaries
        operative.summaries = operative.summaries.map(summary => {
            const fileName = summary.reference.split(/[\/\\]/).pop();
            return {
                ...summary,
                reference: fileName
            };
        });

        // Сохраняем обновленный operative.json
        await writeFile(
            operativeFile,
            JSON.stringify(operative, null, 2)
        );

        // Обрабатываем все файлы memory_*
        for (const file of files) {
            if (file.startsWith('memory_')) {
                const filePath = join(baseDir, file);
                const content = JSON.parse(await readFile(filePath, 'utf-8'));

                // Обновляем reference в содержимом файла
                if (content.summaries) {
                    content.summaries = content.summaries.map(summary => {
                        const fileName = summary.reference.split(/[\/\\]/).pop();
                        return {
                            ...summary,
                            reference: fileName
                        };
                    });

                    // Сохраняем обновленный файл
                    await writeFile(
                        filePath,
                        JSON.stringify(content, null, 2)
                    );
                }
            }
        }

        console.log('Migration completed successfully');
        console.log('Updated operative.json summaries:', operative.summaries.length);
        console.log('Processed memory files:', files.filter(f => f.startsWith('memory_')).length);

    } catch (error) {
        console.error('Migration error:', error);
    }
}

// Запускаем миграцию
migratePaths(); 