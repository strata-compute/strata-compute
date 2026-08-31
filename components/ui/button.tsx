import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-green text-on-accent hover:bg-green-bright active:bg-green font-semibold",
        secondary:
          "bg-surface-2 text-text border border-border hover:border-border-strong hover:bg-elevated",
        outline:
          "border border-border text-text hover:border-border-strong hover:bg-surface",
        ghost: "text-muted hover:text-text hover:bg-surface",
        danger:
          "border border-red/30 text-red hover:bg-red/10 hover:border-red/50",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9.5 px-4 text-[13.5px] [&_svg]:size-4",
        lg: "h-11 px-5 text-[14.5px] [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
