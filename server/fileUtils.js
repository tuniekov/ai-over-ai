import { join } from 'path';
import fs from 'fs/promises';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

export class FileUtils {
  constructor(workspaceDir) {
    this.workspaceDir = workspaceDir;
  }

  async readFile(filename) {
    try {
      const filePath = join(this.workspaceDir, filename);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      throw new Error(`Ошибка чтения файла ${filename}: ${error.message}`);
    }
  }

  async writeFile(filename, content) {
    try {
      const filePath = join(this.workspaceDir, filename);
      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (error) {
      throw new Error(`Ошибка записи файла ${filename}: ${error.message}`);
    }
  }

  async listFiles(path = '') {
    try {
      const targetPath = join(this.workspaceDir, path);
      console.log('targetPath', targetPath);
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      
      const result = await Promise.all(entries.map(async (entry) => {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          return `[папка] ${fullPath}/`;
        } else {
          const stats = await fs.stat(join(targetPath, entry.name));
          const size = (stats.size / 1024).toFixed(1);
          return `[файл] ${fullPath} (${size}KB)`;
        }
      }));
      
      return result.join('\n');
    } catch (error) {
      throw new Error(`Ошибка чтения директории: ${error.message}`);
    }
  }

  async saveHistoryToFile(filename, history) {
    try {
      const filePath = join(this.workspaceDir, filename);
      const historyText = history.map(entry => {
        const role = entry.role === 'user' ? 'Пользователь' : 'Ассистент';
        return `\n=== ${role} ===\n${entry.content}\n`;
      }).join('\n---\n');
      
      const header = `История чата (${new Date().toLocaleString()})\n${'='.repeat(50)}\n`;
      await fs.writeFile(filePath, header + historyText, 'utf-8');
      return true;
    } catch (error) {
      throw new Error(`Ошибка сохранения истории в файл ${filename}: ${error.message}`);
    }
  }

  async ensureDirectoryExists(filePath) {
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
  }

  async writeFile(path, content) {
    const fullPath = join(this.workspaceDir, path);
    await this.ensureDirectoryExists(fullPath);
    await fs.writeFile(fullPath, content);
  }
  
  async listFilesRecursively(subPath = '') {
    try {
      const startPath = join(this.workspaceDir, subPath);
      console.log('Scanning directory:', startPath); // Для отладки

      const files = await fs.readdir(startPath, { withFileTypes: true });
      const paths = [];
      
      for (const file of files) {
        // Используем path.join для корректного объединения путей
        const relativePath = subPath ? join(subPath, file.name) : file.name;
        
        if (file.isDirectory()) {
          paths.push(relativePath + '/');
        } else {
          paths.push(relativePath);
        }
      }
      
      // Сортируем: сначала папки, потом файлы
      return paths.sort((a, b) => {
        const aIsDir = a.endsWith('/');
        const bIsDir = b.endsWith('/');
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

    } catch (error) {
      console.error('Error listing files:', error); // Для отладки
      if (error.code === 'ENOENT') {
        console.log('Directory not found:', subPath); // Для отладки
        return [];
      }
      throw new Error(`Ошибка чтения директории ${subPath}: ${error.message}`);
    }
  }
} 