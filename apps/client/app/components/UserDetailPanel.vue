<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  icon: string;
  action?: string;
  to?: string;
}>();
</script>

<template>
  <section class="detail-panel">
    <header class="detail-panel__header">
      <div class="detail-panel__heading">
        <h2>{{ title }}</h2>
        <slot name="badge" />
      </div>
      <NuxtLink v-if="to" :to="to" class="detail-panel__action">
        {{ action }}
        <Icon name="material-symbols:arrow-forward" aria-hidden="true" />
      </NuxtLink>
      <p>{{ description }}</p>
    </header>
    <div class="detail-panel__body"><slot /></div>
    <slot name="footer" />
  </section>
</template>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.detail-panel__header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 16px; margin-bottom: 20px; }
.detail-panel__heading { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.detail-panel__heading h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.15px; }
.detail-panel__header p { grid-column: 1 / -1; margin: 0; font-size: 12px; line-height: 1.7; color: rgba(var(--v-theme-on-surface), .55); }
.detail-panel__body { min-width: 0; }
.detail-panel__action { display: inline-flex; align-items: center; gap: 6px; color: rgba(var(--v-theme-on-surface), .6); font-size: 12px; font-weight: 500; text-decoration: none; }
.detail-panel__action:hover { color: rgb(var(--v-theme-primary)); }
.detail-panel__action:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 4px; }
@media (max-width: 600px) {
  .detail-panel__header { gap: 8px; }
  .detail-panel__action { font-size: 11px; }
}
</style>
