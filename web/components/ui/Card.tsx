import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type CardVariant = "plain" | "action" | "ink" | "sand" | "error";

const LOOK: Record<CardVariant, string> = {
  plain: "rounded-card border border-line bg-card px-[26px] py-6",
  action: "rounded-card border-[1.5px] border-ink bg-card p-[26px] shadow-action",
  ink: "rounded-panel bg-ink p-[30px] text-on-ink",
  sand: "rounded-tile bg-sand px-[22px] py-5",
  error: "rounded-box border-[1.5px] border-error bg-error-bg px-[18px] py-4",
};

type Props = Omit<ComponentProps<"section">, "ref"> & { variant?: CardVariant; as?: "section" | "div" | "aside" | "article" };

export function Card({ variant = "plain", as: Tag = "section", className, ...rest }: Props) {
  return <Tag className={cn(LOOK[variant], className)} {...rest} />;
}
