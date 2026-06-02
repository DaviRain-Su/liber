// Shared TanStack Query client (spike). One cache for the app; sensible defaults
// for a read-mostly wallet UI — short stale window, no refetch-on-focus thrash.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});
