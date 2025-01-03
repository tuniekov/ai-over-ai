<template>
  <div class="chat-container">
    <div class="model-selector">
      <select v-model="selectedModel" @change="changeModel" :disabled="isLoading">
        <option v-for="(model, key) in AI_MODELS" 
                :key="key" 
                :value="key">
          {{ model.name }}
        </option>
      </select>
      <div class="model-description">
        {{ currentModelDescription }}
      </div>
    </div>

    <div class="messages" ref="messagesContainer">
      <div v-for="(message, index) in messages" 
           :key="index" 
           :class="['message', message.type]">
        <div class="message-header">
          {{ message.type === 'user' ? 'Вы' : 'Ассистент' }}
        </div>
        <div class="message-content">
          {{ message.text }}
        </div>
        <div class="message-time" v-if="message.time">
          {{ formatTime(message.time) }}
        </div>
      </div>
    </div>
    
    <div class="input-container">
      <input 
        v-model="userInput" 
        @keyup.enter="sendMessage"
        placeholder="Введите сообщение..."
        :disabled="isLoading || !selectedModel"
      >
      <button v-if="!isLoading" 
              @click="sendMessage" 
              :disabled="!selectedModel">
        Отправить
      </button>
      <button v-else 
              @click="stopGeneration" 
              class="stop-button">
        Остановить
      </button>
    </div>

    <div class="connection-status" :class="{ disconnected: !isConnected }">
      {{ isConnected ? 'Подключено' : 'Переподключение...' }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { AI_MODELS, DEFAULT_MODEL } from '../settings';

const messages = ref([]);
const userInput = ref('');
const isLoading = ref(false);
const ws = ref(null);
const messagesContainer = ref(null);
const selectedModel = ref(DEFAULT_MODEL);
const currentMessage = ref('');
const isConnected = ref(false);
const reconnectAttempts = ref(0);
const maxReconnectAttempts = 5;

const currentModelDescription = computed(() => {
  return AI_MODELS[selectedModel.value]?.description || '';
});

const changeModel = async () => {
  isLoading.value = true;
  const modelConfig = AI_MODELS[selectedModel.value];
  
  try {
    ws.value.send(JSON.stringify({
      type: 'changeModel',
      modelPath: modelConfig.modelPath
    }));
  } catch (error) {
    messages.value.push({
      type: 'error',
      text: 'Ошибка при смене модели: ' + error.message
    });
    isLoading.value = false;
  }
};

const connectWebSocket = () => {
  if (ws.value && ws.value.readyState === WebSocket.OPEN) return;
  
  try {
    ws.value = new WebSocket('ws://localhost:3000');
    
    ws.value.onopen = () => {
      console.log('WebSocket connected');
      isConnected.value = true;
      reconnectAttempts.value = 0;
      changeModel(); // Инициализируем начальную модель
    };
    
    ws.value.onclose = () => {
      console.log('WebSocket disconnected');
      isConnected.value = false;
      
      // Пытаемся переподключиться
      if (reconnectAttempts.value < maxReconnectAttempts) {
        reconnectAttempts.value++;
        console.log(`Попытка переподключения ${reconnectAttempts.value}/${maxReconnectAttempts}`);
        setTimeout(connectWebSocket, 2000); // Пробуем через 2 секунды
      } else {
        messages.value.push({
          type: 'error',
          text: 'Не удалось подключиться к серверу после нескольких попыток'
        });
      }
    };
    
    ws.value.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        
        if (response.type === 'error') {
          messages.value.push({
            type: 'error',
            text: 'Ошибка: ' + response.message
          });
          isLoading.value = false;
        } else if (response.type === 'modelChanged') {
          messages.value.push({
            type: 'system',
            text: response.message
          });
          isLoading.value = false;
        } else if (response.type === 'partial') {
          if (!currentMessage.value) {
            messages.value.push({
              type: 'bot',
              text: response.message
            });
            currentMessage.value = response.message;
          } else {
            currentMessage.value += response.message;
            messages.value[messages.value.length - 1].text = currentMessage.value;
          }
          scrollToBottom();
        } else if (response.type === 'part_complete') {
          currentMessage.value = '';
        } else if (response.type === 'complete') {
          currentMessage.value = '';
          isLoading.value = false;
        } else if (response.type === 'stopped') {
          currentMessage.value = '';
          isLoading.value = false;
        }
      } catch (error) {
        console.error('Error parsing message:', error);
        messages.value.push({
          type: 'error',
          text: 'Ошибка обработки сообщения'
        });
        isLoading.value = false;
      }
    };
    
    ws.value.onerror = (error) => {
      console.error('WebSocket error:', error);
      messages.value.push({
        type: 'error',
        text: 'Ошибка соединения с сервером'
      });
      isLoading.value = false;
    };
  } catch (error) {
    console.error('Connection error:', error);
    messages.value.push({
      type: 'error',
      text: 'Ошибка при создании соединения'
    });
  }
};

const formatTime = (time) => {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(time);
};

const sendMessage = () => {
  if (!userInput.value.trim() || isLoading.value || !isConnected.value) return;
  
  try {
    messages.value.push({
      type: 'user',
      text: userInput.value,
      time: new Date()
    });
    
    isLoading.value = true;
    ws.value.send(JSON.stringify({
      type: 'message',
      message: userInput.value
    }));
    
    currentMessage.value = '';
    userInput.value = '';
    scrollToBottom();
  } catch (error) {
    console.error('Send message error:', error);
    messages.value.push({
      type: 'error',
      text: 'Ошибка отправки сообщения'
    });
    isLoading.value = false;
  }
};

const scrollToBottom = () => {
  setTimeout(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  }, 100);
};

const stopGeneration = () => {
  if (ws.value && isLoading.value) {
    ws.value.send(JSON.stringify({ type: 'abort' }));
  }
};

onMounted(() => {
  connectWebSocket();
});

onUnmounted(() => {
  if (ws.value) {
    ws.value.close();
  }
});
</script>

<style scoped>
.chat-container {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  height: 600px;
  display: flex;
  flex-direction: column;
  position: relative;
  padding: 20px;
  box-shadow: 0 0 10px rgba(0,0,0,0.1);
  border-radius: 8px;
}

.messages {
  flex-grow: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f5f5f5;
  border-radius: 8px;
  margin-bottom: 20px;
}

.message {
  margin-bottom: 15px;
  max-width: 80%;
  min-width: 200px;
}

.message.user {
  margin-left: auto;
  margin-right: 0;
}

.message.bot {
  margin-right: auto;
  margin-left: 0;
}

.message-content {
  padding: 12px 16px;
  border-radius: 15px;
  background: white;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 14px;
  line-height: 1.5;
}

.message.user .message-content {
  background: #007bff;
  color: white;
}

.message.bot .message-content {
  background: #f8f9fa;
  color: #333;
  border: 1px solid #e9ecef;
}

.message.error .message-content {
  background: #dc3545;
  color: white;
}

.input-container {
  display: flex;
  gap: 10px;
}

input {
  flex-grow: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

button {
  padding: 10px 20px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background: #ccc;
}

.model-selector {
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.model-selector select {
  width: 100%;
  padding: 8px;
  margin-bottom: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.model-description {
  font-size: 0.9em;
  color: #666;
  line-height: 1.4;
}

.message.system .message-content {
  background: #17a2b8;
  color: white;
  font-style: italic;
}

.message.system .message-content::after {
  content: '...';
  animation: loading 1.5s infinite;
}

@keyframes loading {
  0% { content: '.'; }
  33% { content: '..'; }
  66% { content: '...'; }
}

.stop-button {
  background: #dc3545;
}

.stop-button:hover {
  background: #c82333;
}

.connection-status {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 0.8em;
  background: #28a745;
  color: white;
}

.connection-status.disconnected {
  background: #ffc107;
}

.message-header {
  font-size: 0.8em;
  color: #666;
  margin-bottom: 4px;
  font-weight: 500;
}

.message-time {
  font-size: 0.7em;
  color: #999;
  margin-top: 4px;
  text-align: right;
}

.message.user .message-header {
  color: #007bff;
}

.message.bot .message-header {
  color: #28a745;
}
</style> 