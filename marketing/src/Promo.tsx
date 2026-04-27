import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";

const COLORS = {
  bg: "#0F0E2E",
  bgGrad: "linear-gradient(135deg, #1E1B4B 0%, #4F46E5 100%)",
  card: "rgba(30,27,75,0.92)",
  border: "rgba(255,255,255,0.08)",
  accent: "#818CF8",
  white: "#FFFFFF",
  muted: "rgba(255,255,255,0.55)",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif";

const Beacon: React.FC<{ size: number; color?: string }> = ({
  size,
  color = "#fff",
}) => (
  <svg viewBox="0 0 200 200" width={size} height={size}>
    <circle cx="60" cy="100" r="18" fill={color} />
    <path
      d="M 92 68 Q 125 100 92 132"
      fill="none"
      stroke={color}
      strokeWidth="14"
      strokeLinecap="round"
    />
    <path
      d="M 128 48 Q 175 100 128 152"
      fill="none"
      stroke={color}
      strokeWidth="14"
      strokeLinecap="round"
    />
  </svg>
);

type Row = { kind: string; title: string; sub?: string; tint?: string };

const KIND_TINT: Record<string, string> = {
  App: "#60A5FA",
  Snip: "#34D399",
  Link: "#F472B6",
  Cmd: "#FBBF24",
};

const Palette: React.FC<{
  query: string;
  rows: Row[];
  selected: number;
  cursorVisible: boolean;
}> = ({ query, rows, selected, cursorVisible }) => (
  <div
    style={{
      width: 760,
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 18,
      boxShadow:
        "0 30px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
      overflow: "hidden",
      fontFamily: FONT,
    }}
  >
    <div
      style={{
        padding: "22px 26px",
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div style={{ opacity: 0.7 }}>
        <Beacon size={24} color={COLORS.accent} />
      </div>
      <span
        style={{
          color: COLORS.white,
          fontSize: 24,
          fontWeight: 400,
          letterSpacing: -0.2,
        }}
      >
        {query}
        <span
          style={{
            color: COLORS.accent,
            opacity: cursorVisible ? 1 : 0,
            marginLeft: 1,
          }}
        >
          ▍
        </span>
      </span>
    </div>
    {rows.map((r, i) => (
      <div
        key={i}
        style={{
          padding: "14px 26px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          background:
            i === selected ? "rgba(129,140,248,0.18)" : "transparent",
          borderLeft:
            i === selected
              ? `3px solid ${COLORS.accent}`
              : "3px solid transparent",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: (r.tint ?? KIND_TINT[r.kind] ?? "#888") + "33",
            color: r.tint ?? KIND_TINT[r.kind] ?? "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {r.kind}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: COLORS.white, fontSize: 17 }}>{r.title}</div>
          {r.sub && (
            <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
              {r.sub}
            </div>
          )}
        </div>
      </div>
    ))}
  </div>
);

const Keycap: React.FC<{ label: string; pressed: boolean; wide?: boolean }> = ({
  label,
  pressed,
  wide,
}) => (
  <div
    style={{
      minWidth: wide ? 240 : 120,
      height: 120,
      borderRadius: 20,
      border: `2px solid ${COLORS.border}`,
      background: pressed ? COLORS.accent : "rgba(255,255,255,0.06)",
      color: COLORS.white,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 46,
      fontWeight: 500,
      fontFamily: FONT,
      boxShadow: pressed
        ? "0 2px 0 rgba(0,0,0,0.5)"
        : "0 8px 0 rgba(0,0,0,0.5)",
      transform: pressed ? "translateY(6px)" : "translateY(0)",
    }}
  >
    {label}
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const wordOpacity = interpolate(frame, [12, 30], [0, 1], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bgGrad,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div style={{ transform: `scale(${scale})`, opacity: fadeIn }}>
        <Beacon size={240} />
      </div>
      <div
        style={{
          opacity: wordOpacity,
          color: COLORS.white,
          fontSize: 80,
          fontWeight: 600,
          letterSpacing: -2.5,
          fontFamily: FONT,
        }}
      >
        davidcast
      </div>
    </AbsoluteFill>
  );
};

const Hotkey: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });
  const press = spring({
    frame: frame - 22,
    fps,
    config: { damping: 10, stiffness: 200 },
  });
  const pressed = press > 0.3 && frame < 55;
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 44,
        opacity: fadeIn,
      }}
    >
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <Keycap label="⌥" pressed={pressed} />
        <span style={{ color: COLORS.muted, fontSize: 38 }}>+</span>
        <Keycap label="Space" pressed={pressed} wide />
      </div>
      <div
        style={{
          color: COLORS.white,
          fontSize: 30,
          fontFamily: FONT,
          opacity: interpolate(frame, [8, 22], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        Press <span style={{ color: COLORS.accent }}>⌥ Space</span> anywhere
      </div>
    </AbsoluteFill>
  );
};

const PaletteDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slide = spring({ frame, fps, config: { damping: 14 } });
  const slideY = interpolate(slide, [0, 1], [60, 0]);
  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateRight: "clamp",
  });

  const typeStart = 24;
  const word = "tailwind";
  const len = Math.max(
    0,
    Math.min(word.length, Math.floor((frame - typeStart) / 5))
  );
  const query = word.slice(0, len);

  const cursorVisible = Math.floor(frame / 15) % 2 === 0;

  const initialRows: Row[] = [
    { kind: "App", title: "Visual Studio Code", sub: "application" },
    { kind: "Snip", title: "Email signature", sub: "snippet" },
    {
      kind: "Link",
      title: "GitHub Issues",
      sub: "quicklink · github.com/search?q={q}",
    },
    { kind: "Cmd", title: "Show Clipboard History", sub: "built-in command" },
  ];

  const filteredRows: Row[] = [
    {
      kind: "Link",
      title: "Tailwind Docs",
      sub: "quicklink · tailwindcss.com/docs?q={q}",
    },
    { kind: "App", title: "Tailscale", sub: "application" },
  ];

  const showFiltered = query.length >= 3;
  const rows = showFiltered ? filteredRows : initialRows;
  const selected = 0;

  const enterFrame = 100;
  const showPasted = frame >= enterFrame;
  const flash = interpolate(
    frame,
    [enterFrame, enterFrame + 4, enterFrame + 12],
    [0, 0.4, 0],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ transform: `translateY(${slideY}px)`, opacity }}>
        <Palette
          query={query}
          rows={rows}
          selected={selected}
          cursorVisible={cursorVisible}
        />
      </div>
      <AbsoluteFill
        style={{
          background: "white",
          opacity: flash,
          pointerEvents: "none",
        }}
      />
      {showPasted && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            background: "rgba(34,197,94,0.18)",
            border: "1px solid rgba(34,197,94,0.4)",
            color: "#86efac",
            padding: "14px 22px",
            borderRadius: 12,
            fontFamily: FONT,
            fontSize: 18,
            opacity: interpolate(
              frame,
              [enterFrame, enterFrame + 10],
              [0, 1],
              { extrapolateRight: "clamp" }
            ),
          }}
        >
          → Opening tailwindcss.com/docs
        </div>
      )}
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = spring({ frame, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill
      style={{
        background: COLORS.bgGrad,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 22,
      }}
    >
      <div style={{ transform: `scale(${scale})`, opacity: fadeIn }}>
        <Beacon size={150} />
      </div>
      <div
        style={{
          color: COLORS.white,
          fontSize: 60,
          fontWeight: 600,
          letterSpacing: -1.8,
          fontFamily: FONT,
          opacity: fadeIn,
        }}
      >
        davidcast
      </div>
      <div
        style={{
          color: "rgba(255,255,255,0.75)",
          fontSize: 24,
          fontFamily: FONT,
          opacity: interpolate(frame, [15, 35], [0, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      >
        your launcher · your data · your control
      </div>
    </AbsoluteFill>
  );
};

export const Promo: React.FC = () => (
  <AbsoluteFill style={{ background: COLORS.bg }}>
    <Sequence durationInFrames={50}>
      <Intro />
    </Sequence>
    <Sequence from={50} durationInFrames={70}>
      <Hotkey />
    </Sequence>
    <Sequence from={120} durationInFrames={150}>
      <PaletteDemo />
    </Sequence>
    <Sequence from={270} durationInFrames={90}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
