import { ImageResponse } from "next/og";

// Larger icon for iOS home-screen / bookmark contexts.
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
          background: "#4F46E5",
          borderRadius: 38,
        }}
      >
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none">
          <path d="M13 3 4 13.5h7.2L10 21l9-10.5h-7.2L13 3Z" fill="white" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
