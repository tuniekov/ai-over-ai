<template>
  <div class="app">
    <h1>GPT4All Чат</h1>
    <ChatBot />
  </div>
</template>

<script setup>
import ChatBot from './components/ChatBot.vue'
</script>

<style>
.app {
  padding: 20px;
  width: 100vw;
}

h1 {
  text-align: center;
  margin-bottom: 30px;
}
</style>
