"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { TxProvider } from "@/components/tx/TxProvider";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: 2, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <WalletProvider>
          <TxProvider>{children}</TxProvider>
        </WalletProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
