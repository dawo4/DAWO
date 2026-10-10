<script setup lang="ts">
import { useAppStore } from '../store/app'
const app = useAppStore()
</script>

<template>
  <template v-if="app.appearance.orbs">
    <div class="orb" style="width: 420px; height: 420px; top: -120px; left: -100px" />
    <div class="orb" style="width: 300px; height: 300px; bottom: -80px; right: 8%; animation-delay: -6s" />
    <div class="orb" style="width: 200px; height: 200px; top: 40%; left: 55%; animation-delay: -12s" />
  </template>
</template>
