import { onMounted, ref } from "vue";

/** Install counts by plugin id, from the counter in `api/installs.ts`. Empty until loaded, and stays empty if it is unreachable. */
export function useInstallCounts() {
  const counts = ref<Record<string, number>>({});
  onMounted(async () => {
    try {
      const res = await fetch("/api/installs");
      if (res.ok) counts.value = await res.json();
    } catch {
      /* no counter (offline, local preview): show no numbers */
    }
  });
  return counts;
}
