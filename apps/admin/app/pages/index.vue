<script setup lang="ts">
import type { OperatorOrgList } from "@idenzy/protocol/schemas/operator";

/** Organisations: find one by name or id. */
const query = ref("");
const debounced = refDebounced(query, 250);
const url = computed(() => `/v1/operator/orgs?query=${encodeURIComponent(debounced.value)}`);
const { data, isFetching, error } = useOperatorApi()(url, { refetch: true })
  .get()
  .json<OperatorOrgList>();
</script>

<template>
  <section>
    <h1>Organisations</h1>
    <input v-model="query" placeholder="Name, or an org_ id" style="width: 360px" autofocus />
    <p v-if="error" class="warn">Could not load organisations.</p>
    <table v-else style="margin-top: 16px">
      <thead><tr><th>Name</th><th>Id</th><th>Created</th></tr></thead>
      <tbody>
        <tr v-for="org in data?.orgs ?? []" :key="org.id">
          <td><NuxtLink :to="`/orgs/${org.id}`">{{ org.name }}</NuxtLink></td>
          <td class="muted"><code>{{ org.id }}</code></td>
          <td class="muted">{{ new Date(org.createdAt).toLocaleDateString() }}</td>
        </tr>
        <tr v-if="!isFetching && (data?.orgs ?? []).length === 0"><td colspan="3" class="muted">No organisations match.</td></tr>
      </tbody>
    </table>
  </section>
</template>
