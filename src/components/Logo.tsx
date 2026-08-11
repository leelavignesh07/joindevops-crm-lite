/** JoinDevOps interlocking-loop mark + wordmark, per the brand guideline's logo lockup. */
export default function Logo({
  variant = "dark",
  className,
}: {
  variant?: "dark" | "light"; // text color: "dark" = navy text (light backgrounds), "light" = white text (dark backgrounds)
  className?: string;
}) {
  const textColor = variant === "light" ? "#FFFFFF" : "#080E1C";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <svg width="24" height="16" viewBox="0 0 48 32" aria-hidden="true">
        <circle cx="15" cy="16" r="10.5" fill="none" stroke="#6136FF" strokeWidth="7" />
        <circle cx="33" cy="16" r="10.5" fill="none" stroke="#6136FF" strokeWidth="7" />
      </svg>
      <span className="font-poppins text-lg font-extrabold leading-none" style={{ color: textColor }}>
        joindevops.com
      </span>
    </span>
  );
}
