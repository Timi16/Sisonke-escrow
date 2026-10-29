"use client";
import { useId, useState, type ReactNode } from "react";
import { formatUsdc, parseAmountOrZero, toDecimalString } from "@/lib/sisonke/amount";
import type { Escrow } from "@/lib/sisonke/types";
import { Button } from "@/components/ui/Button";
import { AmountInput, FieldError, Hint, Label } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";

type Pick = "recipient" | "half" | "payer";

/** The arbiter's split (WEB_PLAN §6.6): 0 ≤ recipient share ≤ amount. */
export function ResolveForm({
  escrow,
  disabled,
  disabledNote,
  warning,
  onSubmit,
}: {
  escrow: Escrow;
  disabled: boolean;
  disabledNote?: string;
  warning?: ReactNode;
  onSubmit: (recipientAmount: bigint) => void;
}) {
  const inputId = useId();
  const total = escrow.amount;
  const [text, setText] = useState(toDecimalString(total / 2n));
  const [pick, setPick] = useState<Pick | null>("half");

  const parsed = parseAmountOrZero(text);
  let error: string | null = null;
  let r: bigint | null = null;
  if (!parsed.ok) error = parsed.error;
  else if (parsed.stroops > total) error = `The recipient's share must be between 0 and ${formatUsdc(total)} USDC.`;
  else r = parsed.stroops;

  const choose = (p: Pick) => {
    setPick(p);
    const v = p === "recipient" ? total : p === "payer" ? 0n : total / 2n; // the odd stroop goes to the payer
    setText(toDecimalString(v));
  };
  const result = r === null ? null : r === total ? "Released" : r === 0n ? "Refunded" : "Split";

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!disabled && r !== null) onSubmit(r);
      }}
    >
      <Segmented<Pick>
        label="Quick split"
        value={pick}
        onChange={choose}
        options={[
          { value: "recipient", label: "All to recipient" },
          { value: "half", label: "Half each" },
          { value: "payer", label: "All to payer" },
        ]}
      />
      <Label htmlFor={inputId}>To the recipient</Label>
      <AmountInput
        id={inputId}
        value={text}
        invalid={!!error}
        aria-describedby={`${inputId}-hint ${inputId}-err`}
        onChange={(ev) => {
          setText(ev.target.value);
          setPick(null);
        }}
      />
      <FieldError id={`${inputId}-err`}>{error}</FieldError>
      {r !== null && (
        <Hint id={`${inputId}-hint`}>
          The recipient gets {formatUsdc(r)} USDC. The payer gets {formatUsdc(total - r)} USDC. Result: {result}.
        </Hint>
      )}
      {warning}
      <Button type="submit" variant="primary" size="lg" disabled={disabled || r === null}>
        Confirm decision
      </Button>
      <p className="m-0 text-[13px] leading-normal text-muted">{disabledNote ?? "Divides the USDC as set above. It's final."}</p>
    </form>
  );
}
