/**
 * Inline SVG icons, Lucide geometry, stroke-width 1.5–1.8. No icon font (README §Assets).
 *
 * Every path here is taken verbatim from the approved prototype so the drawn shapes are the ones
 * that were reviewed. They are decorative: each is `aria-hidden`, and the control that carries one
 * always has its own text or `aria-label`.
 */
import type { ReactNode } from 'react';

function Svg({
  size,
  width,
  children,
  fill = 'none',
}: {
  size: number;
  width?: number;
  children: ReactNode;
  fill?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'}
      strokeWidth={width ?? 1.6}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconPlus = ({ size = 16, width = 1.6 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M12 5v14M5 12h14" /></Svg>
);

export const IconBack = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
);

export const IconClose = ({ size = 14, width = 1.7 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M6 6l12 12M18 6L6 18" /></Svg>
);

export const IconTick = ({ size = 17, width = 1.8 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M20 6 9 17l-5-5" /></Svg>
);

export const IconInfo = ({ size = 14, width = 1.8 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M12 8v4M12 16h.01" /></Svg>
);

export const IconFolder = ({ size = 17 }: { size?: number }) => (
  <Svg size={size}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>
);

export const IconPlay = ({ size = 16 }: { size?: number }) => (
  <Svg size={size} fill="currentColor"><path d="M8 5l12 7-12 7z" /></Svg>
);

export const IconAlert = ({ size = 17, width = 1.8 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M12 8v4M12 16h.01" /><circle cx="12" cy="12" r="9" /></Svg>
);

export const IconWarnTriangle = ({ size = 17, width = 1.8 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}>
    <path d="M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
  </Svg>
);

export const IconLock = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}><path d="M7 11V8a5 5 0 0 1 10 0v3" /><rect x="4" y="11" width="16" height="9" rx="1.5" /></Svg>
);

export const IconFile = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 3v5h5" />
    <path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
  </Svg>
);

export const IconPaperclip = ({ size = 19 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
  </Svg>
);

export const IconMic = ({ size = 19 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </Svg>
);

export const IconSend = ({ size = 18, width = 1.8 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>
);

export const IconConstellation = ({ size = 15, width = 1.5 }: { size?: number; width?: number }) => (
  <Svg size={size} width={width}>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="4.5" cy="6.5" r="1.8" />
    <circle cx="19.5" cy="6.5" r="1.8" />
    <circle cx="6" cy="18.5" r="1.8" />
    <circle cx="18" cy="18.5" r="1.8" />
    <path d="M10 11 5.6 7.6M14 11l4.2-3.2M10.5 13.6 7.2 17.2M13.6 13.7l3.3 3.4" />
  </Svg>
);

export const IconSettings = ({ size = 15 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.6 14H3.4a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.6 7L4.5 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.6V3.4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);
