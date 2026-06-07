interface AppIconProps {
  name: string;
  className?: string;
}

export function AppIcon({ name, className = "app-icon" }: AppIconProps) {
  return <img className={className} src={`/assets/svg/${name}.svg`} alt="" aria-hidden="true" />;
}
