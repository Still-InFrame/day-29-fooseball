import { ImageResponse } from "next/og";

// Home-screen icon for iOS "Add to Home Screen" (PNG, generated at build).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "#15904b",
        }}
      >
        {/* rods */}
        <div style={{ position: "absolute", left: 40, top: 45, width: 16, height: 90, borderRadius: 8, background: "#3b82f6" }} />
        <div style={{ position: "absolute", right: 40, top: 45, width: 16, height: 90, borderRadius: 8, background: "#ef4444" }} />
        {/* ball */}
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#ffffff" }} />
      </div>
    ),
    { ...size },
  );
}
