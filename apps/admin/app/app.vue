<script setup lang="ts">
import type { OperatorMe } from "@idenzy/protocol/schemas/operator";

const operator = useState<OperatorMe | null>("operator", () => null);
const idenzy = useIdenzy();

async function signOut() {
  await idenzy.signOut();
  operator.value = null;
  await navigateTo("/auth/sign-in");
}
</script>

<template>
  <div class="shell">
    <header>
      <nav style="display: flex; gap: 16px; align-items: baseline">
        <NuxtLink class="brand" to="/">Idenzy operator console</NuxtLink>
        <NuxtLink v-if="operator" to="/invoices/overdue">Overdue invoices</NuxtLink>
      </nav>
      <span v-if="operator" class="who">
        {{ operator.email }} · {{ operator.role }}
        <button type="button" @click="signOut">Sign out</button>
      </span>
    </header>
    <main><NuxtPage /></main>
  </div>
</template>

<style>
:root {
  color-scheme: light dark;
  --ink: #1b1d21;
  --muted: #6b7079;
  --line: #d9dce1;
  --paper: #ffffff;
  --accent: #3257d6;
  --warn: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root { --ink: #e7e9ec; --muted: #9aa0a9; --line: #33373e; --paper: #16181c; --accent: #8aa4ff; --warn: #ff8a80; }
}
body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }
.shell header { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid var(--line); }
.shell main { padding: 24px; max-width: 1100px; margin: 0 auto; }
.brand { font-weight: 600; color: var(--ink); text-decoration: none; }
.who { color: var(--muted); display: flex; gap: 12px; align-items: center; }
button { font: inherit; border: 1px solid var(--line); background: transparent; color: var(--ink); padding: 6px 12px; border-radius: 4px; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input, select, textarea { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: var(--ink); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 500; }
.muted { color: var(--muted); }
.warn { color: var(--warn); }
</style>
