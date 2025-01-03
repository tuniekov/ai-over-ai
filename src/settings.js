export const AI_MODELS = {
  'claude-3-opus': {
    name: 'Claude 3 Opus',
    modelPath: 'claude-3-opus',
    description: 'Самая мощная языковая модель Claude 3',
    temperature: 0.7,
    maxTokens: 4096,
    isAITunnel: true
  },
  'claude-3-sonnet': {
    name: 'Claude 3 Sonnet',
    modelPath: 'claude-3-sonnet',
    description: 'Мощная языковая модель Claude 3 Sonnet',
    temperature: 0.7,
    maxTokens: 4096,
    isAITunnel: true
  },
  'claude-3-haiku': {
    name: 'Claude 3 Haiku',
    modelPath: 'claude-3-haiku',
    description: 'Быстрая языковая модель Claude 3 Haiku',
    temperature: 0.7,
    maxTokens: 4096,
    isAITunnel: true
  },
  'gpt-4o-mini': {
    name: 'GPT-4O Mini',
    modelPath: 'gpt-4o-mini',
    description: 'Компактная версия GPT-4O для быстрых ответов',
    temperature: 0.7,
    maxTokens: 4096,
    isAITunnel: true
  }
};

export const AI_SETTINGS = {
  localai: {
    baseURL: 'http://localhost:8080/v1'
  },
  aitunnel: {
    baseURL: 'https://api.aitunnel.ru/v1',
    models: Object.keys(AI_MODELS)
  }
};

export const DEFAULT_MODEL = 'gpt-4o-mini'; 