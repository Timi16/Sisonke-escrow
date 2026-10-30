import Image from "next/image";
import { cn } from "@/lib/cn";

/** A wallet's official logo (decorative: its name is always written next to it). */
export function WalletLogo({ src, size, round = false, framed = false, className }: { src: string; size: number; round?: boolean; framed?: boolean; className?: string }) {
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      unoptimized
      className={cn("shrink-0 bg-card object-cover", round ? "rounded-pill" : size >= 44 ? "rounded-[13px]" : "rounded-icon", framed && "border border-line", className)}
      style={{ width: size, height: size }}
    />
  );
}
