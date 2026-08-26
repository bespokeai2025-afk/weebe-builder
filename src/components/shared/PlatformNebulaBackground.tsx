import type { CSSProperties } from "react";

const PARTICLES = [
  [3, 42, 2, 0.32, "0s", "7s"],
  [6, 54, 1, 0.45, "1.4s", "8.5s"],
  [9, 35, 2, 0.28, "2.2s", "9s"],
  [12, 62, 1, 0.5, "0.8s", "6.5s"],
  [15, 47, 1, 0.38, "3.5s", "10s"],
  [17, 72, 2, 0.3, "1.8s", "8s"],
  [19, 30, 1, 0.46, "4.2s", "7.5s"],
  [21, 56, 2, 0.55, "0.4s", "6s"],
  [23, 40, 1, 0.34, "2.8s", "9.5s"],
  [25, 67, 2, 0.42, "1.1s", "8.8s"],
  [27, 51, 1, 0.7, "3.7s", "6.8s"],
  [29, 25, 1, 0.28, "2.1s", "10.5s"],
  [30, 60, 2, 0.6, "0.7s", "7.3s"],
  [32, 44, 1, 0.5, "4.6s", "8.2s"],
  [34, 72, 2, 0.32, "1.9s", "9.8s"],
  [36, 34, 1, 0.62, "0.3s", "6.4s"],
  [38, 54, 2, 0.72, "2.6s", "7.7s"],
  [40, 17, 1, 0.24, "4s", "11s"],
  [41, 64, 1, 0.5, "1.2s", "8.4s"],
  [43, 48, 2, 0.9, "0s", "6.2s"],
  [45, 75, 1, 0.34, "3.1s", "9.3s"],
  [46, 37, 1, 0.45, "1.7s", "7.1s"],
  [48, 57, 2, 0.78, "2.4s", "8.6s"],
  [50, 29, 1, 0.3, "0.9s", "10.2s"],
  [51, 67, 1, 0.48, "4.3s", "7.9s"],
  [53, 46, 2, 0.66, "1.5s", "6.9s"],
  [55, 80, 1, 0.25, "3.8s", "9.7s"],
  [57, 35, 1, 0.52, "0.5s", "8.1s"],
  [59, 62, 2, 0.42, "2.9s", "7.4s"],
  [61, 22, 1, 0.28, "1.6s", "10.8s"],
  [63, 53, 2, 0.64, "4.5s", "6.6s"],
  [65, 73, 1, 0.36, "0.2s", "8.9s"],
  [67, 42, 1, 0.48, "2.7s", "7.2s"],
  [69, 58, 2, 0.7, "1.3s", "9.1s"],
  [71, 31, 1, 0.3, "3.4s", "8.3s"],
  [73, 68, 1, 0.55, "0.6s", "6.7s"],
  [75, 49, 2, 0.4, "4.1s", "9.6s"],
  [77, 77, 1, 0.3, "2s", "8.7s"],
  [79, 38, 1, 0.46, "1s", "7.6s"],
  [81, 61, 2, 0.62, "3.6s", "10s"],
  [84, 26, 1, 0.27, "2.5s", "9.4s"],
  [86, 52, 2, 0.5, "0.1s", "7s"],
  [88, 70, 1, 0.36, "4.4s", "8.8s"],
  [90, 43, 1, 0.4, "1.9s", "6.3s"],
  [93, 57, 2, 0.3, "3s", "9.9s"],
  [95, 34, 1, 0.48, "0.8s", "7.8s"],
  [97, 65, 1, 0.28, "2.3s", "10.4s"],
  [13, 79, 1, 0.25, "3.9s", "8.1s"],
  [33, 83, 1, 0.35, "0.6s", "9.2s"],
  [58, 88, 1, 0.3, "2.8s", "7.5s"],
  [76, 88, 1, 0.24, "1.1s", "10.1s"],
] as const;

const STREAKS = [
  [15, 52, -26, 0.26, "0.5s"],
  [20, 35, 18, 0.2, "2.4s"],
  [27, 61, -38, 0.34, "1.2s"],
  [33, 29, 42, 0.18, "3.1s"],
  [38, 55, -18, 0.3, "0.1s"],
  [44, 42, 25, 0.22, "2.2s"],
  [49, 68, -32, 0.38, "1.7s"],
  [55, 31, 48, 0.2, "3.8s"],
  [60, 58, -24, 0.3, "0.8s"],
  [66, 46, 35, 0.25, "2.9s"],
  [72, 64, -42, 0.24, "1.4s"],
  [78, 38, 22, 3, "3.4s"],
] as const;

const CONSTELLATION_LINES = [
  [8, 53, 18, 58],
  [18, 58, 27, 48],
  [27, 48, 35, 53],
  [35, 53, 43, 42],
  [43, 42, 50, 49],
  [50, 49, 58, 43],
  [58, 43, 68, 52],
  [68, 52, 77, 45],
  [22, 69, 31, 61],
  [31, 61, 43, 64],
  [43, 64, 53, 57],
  [53, 57, 64, 67],
  [64, 67, 76, 59],
] as const;

function particleStyle(
  left: number,
  top: number,
  size: number,
  opacity: number,
  delay: string,
  duration: string,
): CSSProperties {
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${size}px`,
    height: `${size}px`,
    opacity,
    animationDelay: delay,
    animationDuration: duration,
  };
}

export function PlatformNebulaBackground() {
  return (
    <div className="platform-nebula" aria-hidden="true">
      <div className="platform-nebula__wash" />
      <div className="platform-nebula__field">
        <div className="platform-nebula__halo platform-nebula__halo--left" />
        <div className="platform-nebula__halo platform-nebula__halo--right" />
        <div className="platform-nebula__core" />
        <svg
          className="platform-nebula__constellation"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {CONSTELLATION_LINES.map(([x1, y1, x2, y2], index) => (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              pathLength="1"
            />
          ))}
        </svg>
        <div className="platform-nebula__particles">
          {PARTICLES.map(([left, top, size, opacity, delay, duration], index) => (
            <span
              key={index}
              className="platform-nebula__particle"
              style={particleStyle(left, top, size, opacity, delay, duration)}
            />
          ))}
        </div>
        <div className="platform-nebula__streaks">
          {STREAKS.map(([left, top, rotate, opacity, delay], index) => (
            <span
              key={index}
              className="platform-nebula__streak"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                opacity,
                "--platform-nebula-angle": `${rotate}deg`,
                animationDelay: delay,
              } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}