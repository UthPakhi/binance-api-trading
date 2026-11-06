import * as React from "react";
import { cn } from "../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-blue-600 text-white hover:bg-blue-500 shadow-sm shadow-blue-900/30": variant === "default",
            "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 border border-neutral-700/60": variant === "secondary",
            "border border-neutral-800 bg-transparent hover:bg-neutral-800 text-neutral-100": variant === "outline",
            "hover:bg-neutral-800 text-neutral-100": variant === "ghost",
            "bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700": variant === "danger",
            "h-11 px-4 py-2": size === "default",
            "h-9 rounded-lg px-3": size === "sm",
            "h-12 rounded-lg px-8 text-base": size === "lg",
            "h-11 w-11": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export default Button;
