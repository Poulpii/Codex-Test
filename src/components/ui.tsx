import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "danger";
type ButtonSize = "default" | "icon" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return <button className={cn("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("ui-card-title", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card-content", className)} {...props} />;
}

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ui-badge", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("ui-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("ui-textarea", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("ui-label", className)} {...props} />;
}

interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
}

export function Dialog({ open, title, onOpenChange, className, children, ...props }: DialogProps) {
  if (!open) return null;
  return (
    <div className="ui-dialog-layer" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <section
        className={cn("ui-dialog", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        {...props}
      >
        {children}
      </section>
    </div>
  );
}

export function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-empty", className)} {...props} />;
}
