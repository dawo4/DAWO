<script setup lang="ts">
import { computed } from 'vue'
import { promptState, settle, confirmState, settleConfirm } from './inkPrompt'
import InkButton from './InkButton.vue'

/** 取消按钮文案为空串时，视为纯提示（只渲染确定键） */
const confirmOnly = computed(() => confirmState.opts.cancelText === '')
const confirmLabel = computed(() => confirmState.opts.confirmText || '确定')
const cancelLabel = computed(() => confirmState.opts.cancelText || '取消')
const confirmVariant = computed(() => (confirmState.opts.danger ? 'danger' : 'primary'))
</script>

<template>
  <Teleport to="body">
    <!-- 确认弹窗 -->
    <Transition name="fade">
      <div v-if="confirmState.open" class="fixed inset-0 z-[90] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="settleConfirm(false)" />
        <div
          class="relative rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] w-[380px] p-5"
          tabindex="-1"
          @keyup.enter="settleConfirm(true)"
          @keyup.esc="settleConfirm(false)"
        >
          <div class="text-sm leading-6">{{ confirmState.title }}</div>
          <div v-if="confirmState.opts.detail" class="text-[12px] text-[var(--text-faint)] leading-5 mt-2">
            {{ confirmState.opts.detail }}
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <InkButton v-if="!confirmOnly" variant="ghost" @click="settleConfirm(false)">{{ cancelLabel }}</InkButton>
            <InkButton :variant="confirmVariant" @click="settleConfirm(true)">{{ confirmLabel }}</InkButton>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 输入弹窗 -->
    <Transition name="fade">
      <div v-if="promptState.open" class="fixed inset-0 z-[90] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/50" @click="settle(null)" />
        <div class="relative rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)] w-[380px] p-5">
          <div class="text-sm mb-3">{{ promptState.title }}</div>
          <input
            v-model="promptState.value"
            class="ink-input mb-4"
            autofocus
            @keyup.enter="settle(promptState.value)"
            @keyup.esc="settle(null)"
          />
          <div class="flex justify-end gap-2">
            <InkButton variant="ghost" @click="settle(null)">取消</InkButton>
            <InkButton @click="settle(promptState.value)">确定</InkButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>