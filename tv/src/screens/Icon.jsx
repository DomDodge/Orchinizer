// Simple stroke icons on a 24x24 grid. Works inside HTML or inside another <svg>.
const PATHS = {
  baton: (
    <>
      <line x1="4" y1="20" x2="17" y2="7" />
      <circle cx="19" cy="5" r="2.5" />
    </>
  ),
  check: <polyline points="5 12.5 10 17.5 19 7" />,
  speaker: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  'speaker-off': (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <line x1="16" y1="9" x2="22" y2="15" />
      <line x1="22" y1="9" x2="16" y2="15" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </>
  ),
}

export default function Icon({ name, size = 24, x, y, className, strokeWidth = 2 }) {
  return (
    <svg
      width={size}
      height={size}
      x={x}
      y={y}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  )
}
