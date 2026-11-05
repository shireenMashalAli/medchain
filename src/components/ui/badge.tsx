import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "border-slate-200 bg-slate-100 text-slate-700",
      success: "border-emerald-200 bg-emerald-50 text-emerald-700",
      pending: "border-amber-200 bg-amber-50 text-amber-700",
      danger: "border-red-200 bg-red-50 text-red-700",
      info: "border-blue-200 bg-blue-50 text-blue-700",
      teal: "border-teal-200 bg-teal-50 text-teal-700",
      violet: "border-violet-200 bg-violet-50 text-violet-700",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
