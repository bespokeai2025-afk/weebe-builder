import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.4),0_0_0_1px_rgba(79,140,255,0.25),0_8px_24px_-8px_rgba(79,140,255,0.45)] hover:brightness-110 hover:shadow-[0_1px_0_rgba(255,255,255,0.16)_inset,0_1px_2px_rgba(0,0,0,0.4),0_0_0_1px_rgba(79,140,255,0.35),0_12px_28px_-8px_rgba(79,140,255,0.6)] active:translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-soft hover:brightness-110",
        outline:
          "border border-border bg-transparent hover:bg-white/[0.04] hover:border-white/15 text-foreground",
        secondary:
          "bg-transparent text-foreground hover:bg-white/[0.04] border border-border",
        ghost: "hover:bg-white/[0.04] text-foreground/90 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);


export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
